import { DeleteCommand, GetCommand, QueryCommand, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const EVENT = { pk: 'EVENT', sk: 'META' };
const conflict = error => Object.assign(new Error('conflict'), { conflict: true, cause: error });
const isConflict = error => error?.name === 'ConditionalCheckFailedException' || error?.name === 'TransactionCanceledException' && (error.CancellationReasons || []).some(r => r.Code === 'ConditionalCheckFailed');
async function guarded(work) { try { return await work(); } catch (error) { throw isConflict(error) ? conflict(error) : error; } }

// One table per event: a single META item plus one PHOTO item per picture.
export function createStore({ client, table }) {
  const strip = ({ pk, sk, ...rest }) => rest;
  return {
    async getMeta() { const { Item } = await client.send(new GetCommand({ TableName: table, Key: EVENT, ConsistentRead: true })); return Item && strip(Item); },
    createMeta: meta => guarded(() => client.send(new PutCommand({ TableName: table, Item: { ...EVENT, ...meta }, ConditionExpression: 'attribute_not_exists(pk)' }))),
    async updateMeta(fields) {
      const names = Object.keys(fields);
      const { Attributes } = await client.send(new UpdateCommand({
        TableName: table, Key: EVENT, ConditionExpression: 'attribute_exists(pk)', ReturnValues: 'ALL_NEW',
        UpdateExpression: 'SET ' + names.map((_, i) => `#f${i} = :v${i}`).join(', '),
        ExpressionAttributeNames: Object.fromEntries(names.map((n, i) => [`#f${i}`, n])),
        ExpressionAttributeValues: Object.fromEntries(names.map((n, i) => [`:v${i}`, fields[n]])),
      }));
      return strip(Attributes);
    },
    async listPhotos() {
      const items = []; let key;
      do {
        const page = await client.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'PHOTO' }, ExclusiveStartKey: key, ConsistentRead: true }));
        items.push(...page.Items.map(strip)); key = page.LastEvaluatedKey;
      } while (key);
      return items;
    },
    async getPhoto(id) { const { Item } = await client.send(new GetCommand({ TableName: table, Key: { pk: 'PHOTO', sk: id }, ConsistentRead: true })); return Item && strip(Item); },
    // Atomic: photo write + byte counter + pause/cap checks succeed or fail together.
    commitPhoto: ({ photo, previous, delta, cap }) => guarded(() => client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: table, Item: { pk: 'PHOTO', sk: photo.id, ...photo },
        ConditionExpression: previous ? 'revision = :prev' : 'attribute_not_exists(sk)', ...(previous ? { ExpressionAttributeValues: { ':prev': previous.revision } } : {}) } },
      { Update: { TableName: table, Key: EVENT,
        UpdateExpression: 'ADD totalBytes :d, backupBytes :b SET updatedAt = :t',
        ConditionExpression: 'attribute_exists(pk) AND totalBytes <= :room' + (previous ? '' : ' AND paused = :no'),
        ExpressionAttributeValues: { ':d': delta, ':b': -(previous?.backupSize || 0), ':t': photo.updatedAt || photo.createdAt, ':room': cap - delta, ...(previous ? {} : { ':no': false }) } } },
    ] }))),
    removePhoto: photo => guarded(() => client.send(new TransactWriteCommand({ TransactItems: [
      { Delete: { TableName: table, Key: { pk: 'PHOTO', sk: photo.id }, ConditionExpression: 'attribute_exists(sk)' } },
      { Update: { TableName: table, Key: EVENT, UpdateExpression: 'ADD totalBytes :d, backupBytes :b', ExpressionAttributeValues: { ':d': -photo.size, ':b': -(photo.backupSize || 0) } } },
    ] }))),
    // Only records the backup if the photo still points at the file that was backed up.
    recordBackup: ({ photoId, imageKey, backupKey, backupSize, cap }) => guarded(() => client.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: table, Key: { pk: 'PHOTO', sk: photoId }, UpdateExpression: 'SET backupKey = :k, backupSize = :s',
        ConditionExpression: 'imageKey = :i AND attribute_not_exists(backupKey)', ExpressionAttributeValues: { ':k': backupKey, ':s': backupSize, ':i': imageKey } } },
      { Update: { TableName: table, Key: EVENT, UpdateExpression: 'ADD backupBytes :s', ConditionExpression: 'backupBytes <= :room', ExpressionAttributeValues: { ':s': backupSize, ':room': cap - backupSize } } },
    ] }))),
  };
}
