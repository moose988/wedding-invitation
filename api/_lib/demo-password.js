import { randomInt } from "node:crypto";

// Same word list and shape as scripts/provision-admins.mjs. That file cannot be
// imported from here because .vercelignore excludes scripts/ from the deployment.
// tests/admin-shared-constants.test.mjs keeps the two lists equal.
export const WORDS = `able acid acre aged also amber angle apple arch area army aunt autumn away
baby back badge bake ball band bank barn base basin bath beach bean bear
beat bell belt bench berry best bike bird black blade blank blue board boat
body bold bone book boot bottle bowl brain branch brave bread brick bridge bright
broad brook brown brush build bulb bunch burst bush butter button cabin cable cake
calm camel camp candle canoe canvas card care cargo carpet carrot cart castle catch
cave cedar chain chair chalk charm chart chase cheese cherry chess chest chief circle
city clay clean clear cliff climb clock cloth cloud clover coach coast coat cocoa
coin cold color comet cook cool copper coral corn cotton couch count court cover
craft crane cream creek crisp cross crown cubic curve daily dance dark dawn deep
deer delta denim desert desk dial diary dish dock door dove draft dragon drawn
dream dress drift drink drum dune eagle early earth easel east easy echo edge
eight elbow elder ember empty engine equal even every extra fable face fair farm
feast fence fern ferry field final finch fire first fish five flag flame flash
fleet flint float floor flour flower fluid flute foam focus fog folder forest fork
fort four fox frame fresh frost fruit full fun future galaxy game garden gate
gentle giant gift ginger glass globe glove gold golf good grain grand grape grass
gravel green grid grove guide guitar habit hair hall hammer hand happy harbor hard
hat hawk hazel heart heat hedge hill hive holly home honey hope horse hotel
hour house human hunt idea inch indigo ink inner iron island ivory jacket jade
jar jelly jewel jolly juice jump jungle kettle key kind king kite kiwi knee
knot lake lamp land lane large laser late lava lawn leaf lemon lens level
light lilac lily lime line lion list little loaf lobby long lotus loud lucky
lunar lunch magic magnet main maple marble march market meadow melon metal middle mild
milk mill mint mirror model moon moss motor mount mouse music nail navy nest
nice night noble north note novel oak oasis ocean olive onion open orange orbit
orchid otter outer owl oyster paddle page paint palm panda paper park pasta path
peach pearl pencil pepper piano picnic pilot pine pink pipe plain plane planet plant
plate plaza plum polar pond pony pool poppy port pouch power prairie press prism
proud puzzle quick quiet quilt rabbit radio rain ranch raven reef ribbon rice rich
ring river road robin rock roof room root rope rose round royal ruby rule
safe sage sail salt sand satin scale scarf school scout sea seed shade shell
shelf shine ship shore silk silver simple sister six sky sleek slope small smile
smooth snow soap sofa soft solar solid song south space spark spice spoon spring
square stable stage stair star steam steel stem step stone storm story stove straw
stream street strong sugar summer sun sunny swan sweet swift table tall teal tent
thick thread three tiger timber tiny toast tomato tooth torch tower town track trail
train tree trout true tulip tuna turtle twin umber union unit upper urban valley
velvet vest violet vivid voice wagon walnut warm water wave west wheat wheel white
wide willow wind window winter wise wood wool yard yellow yoga zebra zero zinc`.split(/\s+/);

// Word-word-word-number from crypto randomness: easy to type, and only ever
// protects a throwaway demo account that expires within 24 hours.
export function generateDemoPassword(random = randomInt) {
  const pick = () => WORDS[random(WORDS.length)];
  const password = `${pick()}-${pick()}-${pick()}-${random(100, 1000)}`;
  return password.length >= 16 ? password : generateDemoPassword(random);
}
