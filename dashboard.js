import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  initFirebase,
  isFirebaseConfigured,
  onAuthStateChanged,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  signInWithCustomToken,
  signOut,
  httpsCallable,
  updateDoc,
  where,
  writeBatch,
} from "./firebase-config.js";
import { exportGuests } from "./export.js";
import { eventUsesGuestSides, getDefaultGuestSide, getEventDisplayTitle, isCelebrationEvent } from "./event-utils.js";
import { createSenderPayload, encodeSenderPayload } from "./sender-codec.js";
import {
  assignmentsForGuest,
  resolveTableName,
  summarizePartySeating,
} from "./seating-utils.js";

const params = new URLSearchParams(window.location.search);
const secureSeatingEditorMode = params.get("seatingEditor") === "1";
const accountSeatingEditorMode = params.get("seatingOnly") === "1";
const requestedSeatingSide = ["bride", "groom", "family"].includes(
  params.get("side"),
)
  ? params.get("side")
  : "";
const seatingEditorMode = secureSeatingEditorMode;
const lastWeddingStorageKey = "da3wa:lastDashboardWeddingId";
const demoDashboardStorageKey = "da3wa:demoDashboardState:v4";
const dashboardSidebarStorageKey = "da3wa:dashboardSidebarCollapsed:v1";
const guestDirectoryPageSize = 6;

const plannerPalette = {
  tableColor: "#F3EBDC",
  borderColor: "#BC9B61",
  chairColor: "#24554A",
};

const pageMeta = {
  overview: {
    eyebrow: "Event command center",
    title: "Overview",
    description:
      "A live operational snapshot of guest progress, seating readiness, and on-the-day attention items.",
  },
  guestSummary: {
    eyebrow: "Guest overview",
    title: "Guest Summary",
    description: "A quick look at your guest list and RSVP replies.",
  },
  guests: {
    eyebrow: "Guest management",
    title: "Guest Directory",
    description: "",
  },
  seating: {
    eyebrow: "Seat planning workspace",
    title: "Seating Planner",
    description:
      "Arrange tables, inspect capacity, and assign seats without leaving the hall layout.",
  },
  checkin: {
    eyebrow: "Venue operations",
    title: "Check-In Access",
    description:
      "Monitor arrivals, open the hostess console, and share the secure on-site check-in link.",
  },
  share: {
    eyebrow: "",
    title: "Links & Invitations",
    description: "",
  },
  settings: {
    eyebrow: "Event configuration",
    title: "Event Settings",
    description: "Manage event details, guest access, seating, and event status.",
  },
  exports: {
    eyebrow: "",
    title: "Exports",
    description: "",
  },
};

const demoWedding = {
  coupleName: "Sara & Khalid",
  brideName: "Sara",
  groomName: "Khalid",
  eventDateISO: "2026-12-20T20:00:00+04:00",
  venueEn: "Pearl Ballroom, Dubai",
  venueAr: "قاعة اللؤلؤة، دبي",
  status: "active",
};

const demoTables = [
  createPlannerTable({
    id: "table-a",
    name: "Moonlight",
    seatCount: 8,
    shape: "round",
    floorZone: "Grand Hall",
    x: 22,
    y: 34,
    width: 184,
    height: 184,
  }),
  createPlannerTable({
    id: "table-b",
    name: "Jasmine",
    seatCount: 10,
    shape: "round",
    floorZone: "Grand Hall",
    x: 55,
    y: 32,
    width: 196,
    height: 196,
    chairColor: "#275F55",
  }),
  createPlannerTable({
    id: "table-c",
    name: "Rose",
    seatCount: 6,
    shape: "horseshoe",
    floorZone: "Family Lounge",
    x: 76,
    y: 58,
    width: 220,
    height: 170,
    chairColor: "#84596A",
  }),
];

const demoGuests = [
  {
    id: "guest-1",
    fullName: "Noor Ahmed",
    phone: "971500000001",
    side: "bride",
    additionalGuests: 2,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-1",
    tableId: "table-a",
    tableName: "Moonlight",
    seatNumber: "4",
    checkedIn: true,
    checkedInAt: "Today, 7:42 PM",
    notes: "VIP family guest",
    inviteSentAt: "Today, 4:15 PM",
    reminderSentAt: "Today, 6:20 PM",
    createdAt: "Today, 1:02 PM",
    updatedAt: "Today, 7:42 PM",
  },
  {
    id: "guest-2",
    fullName: "Omar Hassan",
    phone: "971500000002",
    side: "groom",
    additionalGuests: 1,
    rsvpStatus: "pending",
    guestToken: "demo-token-2",
    tableId: "table-b",
    tableName: "Jasmine",
    seatNumber: "2",
    checkedIn: false,
    checkedInAt: null,
    notes: "",
    inviteSentAt: "Yesterday, 8:10 PM",
    reminderSentAt: null,
    createdAt: "Yesterday, 8:10 PM",
    updatedAt: "Yesterday, 8:10 PM",
  },
  {
    id: "guest-3",
    fullName: "Layla Saeed",
    phone: "971500000003",
    side: "bride",
    additionalGuests: 0,
    rsvpStatus: "declined",
    guestToken: "demo-token-3",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Out of town",
    inviteSentAt: "Yesterday, 2:15 PM",
    reminderSentAt: null,
    createdAt: "Yesterday, 2:15 PM",
    updatedAt: "Yesterday, 5:01 PM",
  },
  {
    id: "guest-4",
    fullName: "Khaled Mansoor",
    phone: "971500000004",
    side: "groom",
    additionalGuests: 3,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-4",
    tableId: "table-a",
    tableName: "Moonlight",
    seatNumber: "6",
    checkedIn: false,
    checkedInAt: null,
    notes: "Needs aisle access",
    inviteSentAt: "Yesterday, 9:30 PM",
    reminderSentAt: "Today, 3:18 PM",
    createdAt: "Yesterday, 9:30 PM",
    updatedAt: "Today, 3:18 PM",
  },
  {
    id: "guest-5",
    fullName: "Mira Rahman",
    phone: "971500000005",
    side: "family",
    additionalGuests: 1,
    rsvpStatus: "pending",
    guestToken: "demo-token-5",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Vegetarian",
    inviteSentAt: null,
    reminderSentAt: null,
    createdAt: "Today, 10:11 AM",
    updatedAt: "Today, 10:11 AM",
  },
  {
    id: "guest-6",
    fullName: "Aisha Nasser",
    phone: "971500000006",
    side: "bride",
    additionalGuests: 0,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-6",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Bride college friend",
    inviteSentAt: "Today, 9:20 AM",
    reminderSentAt: null,
    createdAt: "Today, 9:20 AM",
    updatedAt: "Today, 9:20 AM",
  },
  {
    id: "guest-7",
    fullName: "Hamad Ali",
    phone: "971500000007",
    side: "groom",
    additionalGuests: 4,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-7",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Large family party",
    inviteSentAt: "Yesterday, 6:45 PM",
    reminderSentAt: "Today, 12:30 PM",
    createdAt: "Yesterday, 6:45 PM",
    updatedAt: "Today, 12:30 PM",
  },
  {
    id: "guest-8",
    fullName: "Mariam Saleh",
    phone: "971500000008",
    side: "family",
    additionalGuests: 2,
    rsvpStatus: "pending",
    guestToken: "demo-token-8",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Needs reminder",
    inviteSentAt: "Yesterday, 1:05 PM",
    reminderSentAt: null,
    createdAt: "Yesterday, 1:05 PM",
    updatedAt: "Yesterday, 1:05 PM",
  },
  {
    id: "guest-9",
    fullName: "Yousef Khalifa",
    phone: "971500000009",
    side: "groom",
    additionalGuests: 1,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-9",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: true,
    checkedInAt: "Today, 7:55 PM",
    notes: "Checked in early",
    inviteSentAt: "Today, 11:40 AM",
    reminderSentAt: null,
    createdAt: "Today, 11:40 AM",
    updatedAt: "Today, 7:55 PM",
  },
  {
    id: "guest-10",
    fullName: "Leila Omar",
    phone: "971500000010",
    side: "bride",
    additionalGuests: 5,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-10",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "VIP, keep near family",
    inviteSentAt: "Monday, 5:10 PM",
    reminderSentAt: "Today, 2:15 PM",
    createdAt: "Monday, 5:10 PM",
    updatedAt: "Today, 2:15 PM",
  },
  {
    id: "guest-11",
    fullName: "Faris Mansoor",
    phone: "971500000011",
    side: "family",
    additionalGuests: 3,
    rsvpStatus: "pending",
    guestToken: "demo-token-11",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Family group",
    inviteSentAt: null,
    reminderSentAt: null,
    createdAt: "Today, 12:05 PM",
    updatedAt: "Today, 12:05 PM",
  },
  {
    id: "guest-12",
    fullName: "Noura Saeed",
    phone: "971500000012",
    side: "bride",
    additionalGuests: 1,
    rsvpStatus: "declined",
    guestToken: "demo-token-12",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Travel conflict",
    inviteSentAt: "Sunday, 8:30 PM",
    reminderSentAt: null,
    createdAt: "Sunday, 8:30 PM",
    updatedAt: "Yesterday, 10:14 AM",
  },
  {
    id: "guest-13",
    fullName: "Rashed Adel",
    phone: "971500000013",
    side: "groom",
    additionalGuests: 2,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-13",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Prefers aisle seating",
    inviteSentAt: "Today, 8:15 AM",
    reminderSentAt: null,
    createdAt: "Today, 8:15 AM",
    updatedAt: "Today, 8:15 AM",
  },
  {
    id: "guest-14",
    fullName: "Salma Ibrahim",
    phone: "971500000014",
    side: "family",
    additionalGuests: 0,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-14",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Vegetarian meal",
    inviteSentAt: "Yesterday, 11:50 AM",
    reminderSentAt: null,
    createdAt: "Yesterday, 11:50 AM",
    updatedAt: "Yesterday, 11:50 AM",
  },
  {
    id: "guest-15",
    fullName: "Kareem Noor",
    phone: "971500000015",
    side: "groom",
    additionalGuests: 6,
    rsvpStatus: "pending",
    guestToken: "demo-token-15",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Large mixed-side group",
    inviteSentAt: "Today, 1:25 PM",
    reminderSentAt: null,
    createdAt: "Today, 1:25 PM",
    updatedAt: "Today, 1:25 PM",
  },
  {
    id: "guest-16",
    fullName: "Dana Fouad",
    phone: "971500000016",
    side: "bride",
    additionalGuests: 2,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-16",
    tableId: "table-c",
    tableName: "Rose",
    seatNumber: "1",
    checkedIn: false,
    checkedInAt: null,
    notes: "Bride cousin",
    inviteSentAt: "Today, 9:50 AM",
    reminderSentAt: null,
    createdAt: "Today, 9:50 AM",
    updatedAt: "Today, 9:50 AM",
  },
  {
    id: "guest-17",
    fullName: "Omar Zayed",
    phone: "971500000017",
    side: "groom",
    additionalGuests: 1,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-17",
    tableId: "table-b",
    tableName: "Jasmine",
    seatNumber: "7",
    checkedIn: true,
    checkedInAt: "Today, 8:03 PM",
    notes: "Groom work friend",
    inviteSentAt: "Yesterday, 7:40 PM",
    reminderSentAt: null,
    createdAt: "Yesterday, 7:40 PM",
    updatedAt: "Today, 8:03 PM",
  },
  {
    id: "guest-18",
    fullName: "Hessa Al Maktoum",
    phone: "971500000018",
    side: "family",
    additionalGuests: 3,
    rsvpStatus: "pending",
    guestToken: "demo-token-18",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Awaiting family count",
    inviteSentAt: "Monday, 1:20 PM",
    reminderSentAt: "Today, 4:10 PM",
    createdAt: "Monday, 1:20 PM",
    updatedAt: "Today, 4:10 PM",
  },
  {
    id: "guest-19",
    fullName: "Sultan Al Qasimi",
    phone: "971500000019",
    side: "groom",
    additionalGuests: 0,
    rsvpStatus: "pending",
    guestToken: "demo-token-19",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Needs phone follow-up",
    inviteSentAt: null,
    reminderSentAt: null,
    createdAt: "Today, 2:05 PM",
    updatedAt: "Today, 2:05 PM",
  },
  {
    id: "guest-20",
    fullName: "Reem Abdullah",
    phone: "971500000020",
    side: "bride",
    additionalGuests: 1,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-20",
    tableId: "table-c",
    tableName: "Rose",
    seatNumber: "3",
    checkedIn: false,
    checkedInAt: null,
    notes: "Requests quiet seating",
    inviteSentAt: "Sunday, 6:00 PM",
    reminderSentAt: "Yesterday, 6:30 PM",
    createdAt: "Sunday, 6:00 PM",
    updatedAt: "Yesterday, 6:30 PM",
  },
  {
    id: "guest-21",
    fullName: "Mansoor Habib",
    phone: "971500000021",
    side: "family",
    additionalGuests: 4,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-21",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Family table preferred",
    inviteSentAt: "Yesterday, 10:35 AM",
    reminderSentAt: null,
    createdAt: "Yesterday, 10:35 AM",
    updatedAt: "Yesterday, 10:35 AM",
  },
  {
    id: "guest-22",
    fullName: "Fatima Salem",
    phone: "971500000022",
    side: "bride",
    additionalGuests: 0,
    rsvpStatus: "declined",
    guestToken: "demo-token-22",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Sent regrets",
    inviteSentAt: "Friday, 4:25 PM",
    reminderSentAt: null,
    createdAt: "Friday, 4:25 PM",
    updatedAt: "Monday, 9:15 AM",
  },
  {
    id: "guest-23",
    fullName: "Adel Younis",
    phone: "971500000023",
    side: "groom",
    additionalGuests: 2,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-23",
    tableId: "table-a",
    tableName: "Moonlight",
    seatNumber: "8",
    checkedIn: true,
    checkedInAt: "Today, 8:12 PM",
    notes: "VIP business guest",
    inviteSentAt: "Today, 8:25 AM",
    reminderSentAt: null,
    createdAt: "Today, 8:25 AM",
    updatedAt: "Today, 8:12 PM",
  },
  {
    id: "guest-24",
    fullName: "Rana Mahdi",
    phone: "971500000024",
    side: "groom",
    additionalGuests: 1,
    rsvpStatus: "pending",
    guestToken: "demo-token-24",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Friend of the couple",
    inviteSentAt: "Yesterday, 3:10 PM",
    reminderSentAt: null,
    createdAt: "Yesterday, 3:10 PM",
    updatedAt: "Yesterday, 3:10 PM",
  },
  {
    id: "guest-25",
    fullName: "Tariq Nabil",
    phone: "971500000025",
    side: "groom",
    additionalGuests: 5,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-25",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Large party, assign together",
    inviteSentAt: "Monday, 11:15 AM",
    reminderSentAt: "Today, 5:05 PM",
    createdAt: "Monday, 11:15 AM",
    updatedAt: "Today, 5:05 PM",
  },
  {
    id: "guest-26",
    fullName: "Amal Kareem",
    phone: "971500000026",
    side: "bride",
    additionalGuests: 2,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-26",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Requires accessible route",
    inviteSentAt: "Today, 12:45 PM",
    reminderSentAt: null,
    createdAt: "Today, 12:45 PM",
    updatedAt: "Today, 12:45 PM",
  },
  {
    id: "guest-27",
    fullName: "Majid Farah",
    phone: "971500000027",
    side: "family",
    additionalGuests: 0,
    rsvpStatus: "pending",
    guestToken: "demo-token-27",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "No RSVP yet",
    inviteSentAt: "Today, 10:30 AM",
    reminderSentAt: null,
    createdAt: "Today, 10:30 AM",
    updatedAt: "Today, 10:30 AM",
  },
  {
    id: "guest-28",
    fullName: "Lina Jamal",
    phone: "971500000028",
    side: "bride",
    additionalGuests: 1,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-28",
    tableId: "table-c",
    tableName: "Rose",
    seatNumber: "5",
    checkedIn: true,
    checkedInAt: "Today, 8:18 PM",
    notes: "Makeup artist guest",
    inviteSentAt: "Yesterday, 9:05 AM",
    reminderSentAt: null,
    createdAt: "Yesterday, 9:05 AM",
    updatedAt: "Today, 8:18 PM",
  },
  {
    id: "guest-29",
    fullName: "Bilal Hamdan",
    phone: "971500000029",
    side: "groom",
    additionalGuests: 3,
    rsvpStatus: "declined",
    guestToken: "demo-token-29",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Unable to travel",
    inviteSentAt: "Saturday, 2:50 PM",
    reminderSentAt: null,
    createdAt: "Saturday, 2:50 PM",
    updatedAt: "Yesterday, 7:20 PM",
  },
  {
    id: "guest-30",
    fullName: "Samar Hadi",
    phone: "971500000030",
    side: "family",
    additionalGuests: 2,
    rsvpStatus: "confirmed",
    guestToken: "demo-token-30",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Prefers near entrance",
    inviteSentAt: "Today, 3:35 PM",
    reminderSentAt: null,
    createdAt: "Today, 3:35 PM",
    updatedAt: "Today, 3:35 PM",
  },
];

const seatingTestGuests = [
  ["test-guest-1", "Aisha Nasser", "971551000001", "bride", 0],
  ["test-guest-2", "Hamad Ali", "971551000002", "groom", 1],
  ["test-guest-3", "Mariam Saleh", "971551000003", "family", 2],
  ["test-guest-4", "Yousef Khalifa", "971551000004", "groom", 3],
  ["test-guest-5", "Leila Omar", "971551000005", "bride", 0],
  ["test-guest-6", "Faris Mansoor", "971551000006", "family", 1],
  ["test-guest-7", "Noura Saeed", "971551000007", "bride", 2],
  ["test-guest-8", "Rashed Adel", "971551000008", "groom", 3],
  ["test-guest-9", "Salma Ibrahim", "971551000009", "family", 0],
  ["test-guest-10", "Omar Zayed", "971551000010", "groom", 1],
  ["test-guest-11", "Dana Fouad", "971551000011", "bride", 2],
  ["test-guest-12", "Kareem Noor", "971551000012", "family", 3],
].map(([id, fullName, phone, side, additionalGuests]) => ({
  id,
  fullName,
  phone,
  side,
  additionalGuests,
  rsvpStatus: "confirmed",
  guestToken: `${id}-token`,
  tableId: "",
  tableName: "",
  seatNumber: "",
  seatingAssignments: [],
  checkedIn: false,
  checkedInAt: null,
  notes: "Demo seating test guest",
  inviteSentAt: null,
  reminderSentAt: null,
  createdAt: "Demo",
  updatedAt: "Demo",
}));

const demoSeedGuests = [...demoGuests, ...seatingTestGuests];

const state = {
  weddingId: params.get("wedding") || "",
  editorMode: seatingEditorMode,
  secureEditorMode: secureSeatingEditorMode,
  editorLinkToken: params.get("token") || "",
  editorRole: "",
  // Demo data is opt-in only. A wedding ID that happens to contain "demo"
  // is still a real Firestore document and must use live synchronization.
  mode: params.get("demo") === "1" ? "demo" : "live",
  services: null,
  currentUser: null,
  permissions: null,
  wedding: null,
  guests: [],
  tables: [],
  hallObjects: createHallObjects(),
  selectedHallObjectId: "",
  selectedGuestId: "",
  selectedGuestIds: [],
  activeView: pageMeta[params.get("view")] ? params.get("view") : "overview",
  selectedTableId: "",
  selectedSeatId: "",
  seatingPanelTab: "guests",
  seatingGuestSearch: "",
  seatingGuestFilter: "all",
  guestAssignmentSearch: "",
  assignmentSession: null,
  activePartyGuestId: "",
  pendingPartyUnassignId: "",
  pendingPartyUnassignSignature: "",
  activeModalOperation: "",
  modalError: "",
  returnFocusSelector: "",
  plannerZoom: 1,
  plannerViewCenter: null,
  plannerMapWidth: 0,
  mobileSeatingMode: "assign",
  mobileSeatingView: "tables",
  mobileMapOpen: false,
  mobileSavedScrollY: 0,
  mobileTouchGesture: null,
  showFullSeatingSummary: false,
  mobileAssignmentFilter: "unassigned",
  renderedMobileSeatingLayout: null,
  dragState: null,
  guestFilters: {
    search: "",
    rsvp: "all",
    side: "all",
  },
  guestPageIndex: 0,
  libraryFilters: {
    rsvp: "all",
    side: "all",
    vipOnly: false,
  },
  activeGuestMenu: null,
  lastGuestMenuTrigger: null,
  sidebarOpen: false,
  sidebarCollapsed: loadDesktopSidebarPreference(),
  authRedirectMessage: "",
  loadingGuests: true,
  loadingTables: true,
  firestoreGuestCount: 0,
  firestoreGuestIds: [],
  publicMirrorsReconciled: false,
  saveState: "saved",
  dirtyGuestForm: false,
  dirtyTableForm: false,
  dirtyDanceFloorForm: false,
  dirtyEventSettings: false,
  savingEventSettings: false,
  eventSettingsDraft: null,
  eventSettingsOriginal: null,
  eventSettingsErrors: {},
  eventSettingWrites: {},
  eventSettingsMessage: "",
  eventStatusPending: false,
  eventLifecycleMessage: "",
  unsubGuests: null,
  unsubTables: null,
  unsubWedding: null,
  unsubSeatingAccess: null,
  unsubAuth: null,
  initialized: false,
  listenerGeneration: 0,
  seatingAccess: { bride: null, groom: null, family: null },
};

const elements = {
  dashboardApp: document.getElementById("dashboardApp"),
  dashboardSidebar: document.getElementById("dashboardSidebar"),
  allEventsNavLink: document.getElementById("allEventsNavLink"),
  desktopSidebarToggleButton: document.getElementById("desktopSidebarToggleButton"),
  desktopSidebarExpandButton: document.getElementById("desktopSidebarExpandButton"),
  seatingMobileNavButton: document.getElementById("seatingMobileNavButton"),
  sidebarCloseButton: document.getElementById("sidebarCloseButton"),
  pageEyebrow: document.getElementById("pageEyebrow"),
  pageTitle: document.getElementById("pageTitle"),
  pageDescription: document.getElementById("pageDescription"),
  liveIndicator: document.getElementById("liveIndicator"),
  globalActions: document.getElementById("globalActions"),
  pageContent: document.getElementById("pageContent"),
  navToggleButton: document.getElementById("navToggleButton"),
  signOutButton: document.getElementById("signOutButton"),
  signedInUserName: document.getElementById("signedInUserName"),
  guestModal: document.getElementById("guestModal"),
  guestForm: document.getElementById("guestForm"),
  guestModalTitle: document.getElementById("guestModalTitle"),
  guestDeleteButton: document.getElementById("guestDeleteButton"),
  bulkAddModal: document.getElementById("bulkAddModal"),
  bulkAddForm: document.getElementById("bulkAddForm"),
  bulkAddPreview: document.getElementById("bulkAddPreview"),
  tableModal: document.getElementById("tableModal"),
  tableForm: document.getElementById("tableForm"),
  tableModalTitle: document.getElementById("tableModalTitle"),
  tableDeleteButton: document.getElementById("tableDeleteButton"),
  tableDeleteModal: document.getElementById("tableDeleteModal"),
  tableDeleteContent: document.getElementById("tableDeleteContent"),
  tableDeleteConfirmButton: document.getElementById("tableDeleteConfirmButton"),
  danceFloorModal: document.getElementById("danceFloorModal"),
  danceFloorForm: document.getElementById("danceFloorForm"),
  danceFloorModalTitle: document.getElementById("danceFloorModalTitle"),
  assignmentModal: document.getElementById("assignmentModal"),
  assignmentContent: document.getElementById("assignmentContent"),
  chairDetailsModal: document.getElementById("chairDetailsModal"),
  chairDetailsContent: document.getElementById("chairDetailsContent"),
  missingSeatsModal: document.getElementById("missingSeatsModal"),
  missingSeatsContent: document.getElementById("missingSeatsContent"),
  toastRail: document.getElementById("toastRail"),
};

init();

async function init() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  bindEvents();
  window.addEventListener("pagehide", disposeDashboardListeners, { once: true });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirtyEventSettings) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (state.mode === "demo") {
    loadDemoDashboard();
    return;
  }

  if (!isFirebaseConfigured()) {
    redirectToLogin("firebase-not-configured");
    return;
  }

  state.services = initFirebase();

  if (state.secureEditorMode) {
    await bootstrapSeatingEditor();
    return;
  }

  state.unsubAuth?.();
  state.unsubAuth = onAuthStateChanged(state.services.auth, async (user) => {
    state.currentUser = user;
    if (!user) {
      const message = state.authRedirectMessage || "session-required";
      state.authRedirectMessage = "";
      redirectToLogin(message);
      return;
    }
    if (!state.weddingId) {
      if (!state.editorMode) {
        window.location.replace("./weddings.html");
        return;
      }
      state.weddingId = await resolveAccessibleWeddingId(user);
      if (!state.weddingId) {
        redirectToLogin("access-denied");
        return;
      }
      window.history.replaceState(
        null,
        "",
        `./dashboard.html?wedding=${encodeURIComponent(state.weddingId)}`,
      );
    }
    await bootstrapDashboard();
  });
}

function bindEvents() {
  elements.signOutButton?.addEventListener("click", async () => {
    if (state.services?.auth) {
      state.authRedirectMessage = "signed-out";
      await signOut(state.services.auth);
    }
  });
  elements.navToggleButton?.addEventListener("click", () => {
    toggleMobileSidebar();
  });
  elements.seatingMobileNavButton?.addEventListener("click", toggleMobileSidebar);
  elements.sidebarCloseButton?.addEventListener("click", closeMobileSidebar);
  elements.desktopSidebarToggleButton?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    try {
      window.localStorage.setItem(
        dashboardSidebarStorageKey,
        state.sidebarCollapsed ? "1" : "0",
      );
    } catch {}
    updateSidebarState();
    refreshPlannerAfterSidebarChange();
    if (state.sidebarCollapsed) elements.desktopSidebarToggleButton?.focus();
  });
  elements.desktopSidebarExpandButton?.addEventListener("click", () => {
    state.sidebarCollapsed = false;
    try {
      window.localStorage.setItem(dashboardSidebarStorageKey, "0");
    } catch {}
    updateSidebarState();
    refreshPlannerAfterSidebarChange();
    elements.desktopSidebarToggleButton?.focus();
  });
  window.addEventListener("resize", () => {
    updateSidebarState();
    refreshPlannerAfterSidebarChange();
  });
  elements.guestForm?.addEventListener("submit", saveGuest);
  elements.tableForm?.addEventListener("submit", saveTable);
  elements.danceFloorForm?.addEventListener("submit", saveDanceFloor);
  elements.bulkAddForm?.addEventListener("submit", saveBulkGuests);
  elements.bulkAddForm?.entries?.addEventListener(
    "input",
    updateBulkAddPreview,
  );
  elements.tableDeleteButton?.addEventListener("click", () => {
    if (state.selectedTableId) {
      openTableDeleteModal(state.selectedTableId);
    }
  });
  elements.tableDeleteConfirmButton?.addEventListener("click", () => {
    void deleteSelectedTableFromModal();
  });
  elements.guestDeleteButton?.addEventListener("click", async () => {
    if (!state.selectedGuestId) {
      return;
    }
    const guest = state.guests.find(
      (item) => item.id === state.selectedGuestId,
    );
    if (!guest) {
      return;
    }
    const confirmed = window.confirm(
      `Delete ${guest.fullName}? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    elements.guestModal.close();
    await deleteGuest(guest.id);
  });

  elements.guestForm?.addEventListener("input", () => {
    state.dirtyGuestForm = true;
  });
  elements.tableForm?.addEventListener("input", () => {
    state.dirtyTableForm = true;
  });
  elements.danceFloorForm?.addEventListener("input", () => {
    state.dirtyDanceFloorForm = true;
  });
  elements.danceFloorForm?.shape?.addEventListener("change", syncDanceFloorDimensions);
  elements.danceFloorForm?.width?.addEventListener("input", () => {
    if (elements.danceFloorForm.shape.value === "round") syncDanceFloorDimensions();
  });

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("keydown", handleDocumentKeydown);
  elements.pageContent?.addEventListener("submit", (event) => {
    if (event.target?.id === "eventSettingsForm") void saveEventSettings(event);
  });
  elements.guestModal?.addEventListener("click", handleDialogBackdropClick);
  elements.bulkAddModal?.addEventListener("click", handleDialogBackdropClick);
  elements.tableModal?.addEventListener("click", handleDialogBackdropClick);
  elements.danceFloorModal?.addEventListener("click", handleDialogBackdropClick);
  elements.tableDeleteModal?.addEventListener(
    "click",
    handleDialogBackdropClick,
  );
  elements.assignmentModal?.addEventListener(
    "click",
    handleDialogBackdropClick,
  );
  elements.chairDetailsModal?.addEventListener(
    "click",
    handleDialogBackdropClick,
  );
  elements.missingSeatsModal?.addEventListener(
    "click",
    handleDialogBackdropClick,
  );
  elements.guestModal?.addEventListener("cancel", (event) => {
    if (state.dirtyGuestForm && !window.confirm("Discard guest changes?")) {
      event.preventDefault();
    }
  });
  elements.tableModal?.addEventListener("cancel", (event) => {
    if (state.dirtyTableForm && !window.confirm("Discard table changes?")) {
      event.preventDefault();
    }
  });
  elements.bulkAddModal?.addEventListener("cancel", (event) => {
    if (bulkAddHasContent() && !window.confirm("Discard this guest list?")) {
      event.preventDefault();
    }
  });
  [
    elements.tableDeleteModal,
    elements.assignmentModal,
    elements.chairDetailsModal,
    elements.missingSeatsModal,
  ].forEach((modal) => {
    modal?.addEventListener("cancel", (event) => {
      if (state.activeModalOperation) {
        event.preventDefault();
      }
      if (modal === elements.assignmentModal) {
        cancelAssignmentSession();
      }
    });
  });
  elements.guestModal?.addEventListener("close", () => {
    document.body.classList.remove("is-modal-open");
    state.dirtyGuestForm = false;
  });
  elements.tableModal?.addEventListener("close", () => {
    document.body.classList.remove("is-modal-open");
    state.dirtyTableForm = false;
  });
  elements.danceFloorModal?.addEventListener("close", () => {
    document.body.classList.remove("is-modal-open");
    state.dirtyDanceFloorForm = false;
  });
  [
    elements.tableDeleteModal,
    elements.assignmentModal,
    elements.chairDetailsModal,
    elements.missingSeatsModal,
    elements.bulkAddModal,
  ].forEach((modal) => {
    modal?.addEventListener("close", () => {
      if (
        ![
          elements.guestModal,
          elements.tableModal,
          elements.tableDeleteModal,
          elements.assignmentModal,
          elements.chairDetailsModal,
          elements.missingSeatsModal,
          elements.bulkAddModal,
        ].some((item) => item?.open)
      ) {
        document.body.classList.remove("is-modal-open");
      }
      if (!state.activeModalOperation) {
        state.modalError = "";
      }
      if (modal === elements.chairDetailsModal && !state.assignmentSession) {
        state.activePartyGuestId = "";
        state.pendingPartyUnassignId = "";
        state.pendingPartyUnassignSignature = "";
        renderActiveView();
      }
      restoreModalFocus();
    });
  });
  window.addEventListener("scroll", closeGuestMenu, true);
  window.addEventListener("resize", closeGuestMenu);
  window.addEventListener("resize", refreshPlannerAfterSidebarChange);
  window.addEventListener("resize", refreshMobileSeatingLayout);
  window.addEventListener("pointermove", handlePlannerPointerMove);
  window.addEventListener("pointerup", handlePlannerPointerUp);
  window.addEventListener("pointercancel", handlePlannerPointerCancel);
}

function handleDocumentClick(event) {
  const navButton = event.target.closest("[data-nav-view]");
  if (navButton) {
    closeGuestMenu();
    switchView(navButton.dataset.navView);
    return;
  }

  const closeTrigger = event.target.closest("[data-close-modal]");
  if (closeTrigger) {
    if (state.activeModalOperation) {
      return;
    }
    const modal = document.getElementById(closeTrigger.dataset.closeModal);
    if (
      closeTrigger.dataset.closeModal === "guestModal" &&
      state.dirtyGuestForm
    ) {
      const shouldClose = window.confirm("Discard guest changes?");
      if (!shouldClose) {
        return;
      }
      state.dirtyGuestForm = false;
    }
    if (
      closeTrigger.dataset.closeModal === "tableModal" &&
      state.dirtyTableForm
    ) {
      const shouldClose = window.confirm("Discard table changes?");
      if (!shouldClose) {
        return;
      }
      state.dirtyTableForm = false;
    }
    if (
      closeTrigger.dataset.closeModal === "bulkAddModal" &&
      bulkAddHasContent()
    ) {
      if (!window.confirm("Discard this guest list?")) {
        return;
      }
    }
    if (closeTrigger.dataset.closeModal === "assignmentModal") {
      cancelAssignmentSession();
    }
    modal?.close();
    return;
  }

  const actionNode = event.target.closest("[data-action]");
  if (actionNode) {
    if (
      actionNode.disabled ||
      actionNode.getAttribute("aria-disabled") === "true"
    ) {
      event.preventDefault();
      return;
    }
    const action = actionNode.dataset.action;
    const fromGuestMenu = Boolean(actionNode.closest(".guest-menu"));
    if (fromGuestMenu) {
      closeGuestMenu({ restoreFocus: false });
    }
    void handleAction(action, actionNode.dataset, event);
    return;
  }

  if (
    state.activeGuestMenu &&
    !event.target.closest(".guest-menu") &&
    !event.target.closest(".guest-row__menu-toggle")
  ) {
    closeGuestMenu();
  }
}

function handleDialogBackdropClick(event) {
  if (event.target !== event.currentTarget) {
    return;
  }
  if (state.activeModalOperation) {
    return;
  }
  const modal = event.currentTarget;
  if (
    modal.id === "guestModal" &&
    state.dirtyGuestForm &&
    !window.confirm("Discard guest changes?")
  ) {
    return;
  }
  if (
    modal.id === "tableModal" &&
    state.dirtyTableForm &&
    !window.confirm("Discard table changes?")
  ) {
    return;
  }
  if (
    modal.id === "bulkAddModal" &&
    bulkAddHasContent() &&
    !window.confirm("Discard this guest list?")
  ) {
    return;
  }
  if (modal.id === "assignmentModal") {
    cancelAssignmentSession();
  }
  modal.close();
}

function handleDocumentInput(event) {
  const settingsField = event.target.closest("[data-event-setting-field]");
  if (settingsField) {
    syncEventSettingsDraftFromForm();
    state.dirtyEventSettings = Object.keys(state.eventSettingsOriginal || {}).some(
      (key) => state.eventSettingsDraft?.[key] !== state.eventSettingsOriginal?.[key],
    );
    state.eventSettingsMessage = "";
    if (state.eventSettingsErrors) delete state.eventSettingsErrors[settingsField.name];
    updateEventSettingsFormState();
    settingsField.removeAttribute("aria-invalid");
    const error = settingsField.closest("label")?.querySelector(".event-setting-error");
    if (error) error.textContent = "";
    return;
  }

  if (event.target === elements.guestForm?.fullName) {
    event.target.setCustomValidity(
      event.target.value.trim() ? "" : "Enter the guest's full name.",
    );
    return;
  }

  if (event.target === elements.guestForm?.additionalGuests) {
    event.target.setCustomValidity(
      parseAdditionalGuests(event.target.value) === null
        ? "Enter a whole number of 0 or more."
        : "",
    );
    return;
  }

  const search = event.target.closest("[data-guest-search]");
  if (search) {
    const selectionStart = search.selectionStart;
    const selectionEnd = search.selectionEnd;
    state.guestFilters.search = search.value.trim();
    state.guestPageIndex = 0;
    closeGuestMenu({ restoreFocus: false });
    renderActiveView();
    restoreGuestSearchFocus(selectionStart, selectionEnd);
    return;
  }

  const seatSearch = event.target.closest("[data-seat-search]");
  if (seatSearch) {
    state.guestAssignmentSearch = seatSearch.value.trim().toLowerCase();
    if (elements.assignmentModal?.open) {
      renderAssignmentModal();
      requestAnimationFrame(() => {
        const nextSearch =
          elements.assignmentModal.querySelector("[data-seat-search]");
        if (!nextSearch) {
          return;
        }
        nextSearch.focus();
        const cursorPosition = nextSearch.value.length;
        nextSearch.setSelectionRange?.(cursorPosition, cursorPosition);
      });
    } else {
      renderActiveView();
    }
    return;
  }

  const seatingGuestSearch = event.target.closest(
    "[data-seating-guest-search]",
  );
  if (seatingGuestSearch) {
    const selectionStart = seatingGuestSearch.selectionStart;
    const selectionEnd = seatingGuestSearch.selectionEnd;
    state.seatingGuestSearch = seatingGuestSearch.value;
    renderActiveView();
    requestAnimationFrame(() => {
      const nextSearch = document.querySelector("[data-seating-guest-search]");
      nextSearch?.focus();
      nextSearch?.setSelectionRange?.(selectionStart, selectionEnd);
    });
  }
}

async function bootstrapSeatingEditor() {
  try {
    let user = state.services.auth.currentUser;
    if (state.editorLinkToken) {
      const exchange = httpsCallable(
        state.services.functions,
        "exchangeSeatingEditorLink",
      );
      const result = await exchange({ token: state.editorLinkToken });
      await signInWithCustomToken(state.services.auth, result.data.customToken);
      window.history.replaceState(null, "", "./dashboard.html?seatingEditor=1");
      user = state.services.auth.currentUser;
    }
    if (!user) {
      throw new Error("This access link has expired or been revoked.");
    }
    const token = await user.getIdTokenResult(true);
    const claims = token.claims;
    if (
      !claims.seatingEditor ||
      !["bride", "groom", "family"].includes(claims.seatingRole) ||
      !claims.seatingWeddingId
    ) {
      throw new Error("This access link has expired or been revoked.");
    }
    state.currentUser = user;
    state.weddingId = claims.seatingWeddingId;
    state.editorRole = claims.seatingRole;
    // Family link sessions are deliberately view-only. Bride and Groom have
    // occupancy controls, while Firestore separately limits secure-link
    // table writes to chair assignment fields.
    state.permissions = {
      role: claims.seatingRole,
      canEditSeating: ["bride", "groom"].includes(claims.seatingRole),
    };
    const weddingSnapshot = await getDoc(doc(state.services.db, "weddings", state.weddingId));
    if (!weddingSnapshot.exists()) throw new Error("This event is no longer available.");
    state.wedding = { ...weddingSnapshot.data(), id: weddingSnapshot.id };
    state.activeView = "seating";
    showDashboard();
    renderAll();
    startWeddingListener();
    startListeners();
  } catch (error) {
    console.error(error);
    showEditorAccessError();
  }
}

function showEditorAccessError() {
  elements.dashboardApp.hidden = false;
  elements.dashboardSidebar.hidden = true;
  elements.pageEyebrow.textContent = "Seating access";
  elements.pageTitle.textContent = "Access unavailable";
  elements.pageDescription.textContent =
    "Your access link has expired or been revoked.";
  elements.globalActions.innerHTML = "";
  elements.pageContent.innerHTML =
    '<section class="share-page"><article class="share-card"><h3>Your seating editor link is unavailable</h3><p>Please ask the dashboard owner to generate a new link.</p></article></section>';
}

function handleDocumentChange(event) {
  const eventSetting = event.target.closest(
    "[data-action='toggle-event-qr'], [data-action='toggle-event-seating']",
  );
  if (eventSetting) {
    const key = eventSetting.dataset.action === "toggle-event-qr"
      ? "showInvitationQr"
      : "seatingEnabled";
    void queueEventSettingSave(key, eventSetting.checked);
    return;
  }

  const guestFilter = event.target.closest("[data-guest-filter]");
  if (guestFilter) {
    state.guestFilters[guestFilter.dataset.guestFilter] = guestFilter.value;
    state.guestPageIndex = 0;
    closeGuestMenu({ restoreFocus: false });
    renderActiveView();
    return;
  }

  const selectedGuest = event.target.closest("[data-guest-select]");
  if (selectedGuest) {
    toggleGuestSelection(selectedGuest.value, selectedGuest.checked);
    renderActiveView();
    return;
  }

  const guestRsvpStatus = event.target.closest("[data-guest-rsvp-status]");
  if (guestRsvpStatus) {
    void updateGuest(guestRsvpStatus.dataset.guestId, {
      rsvpStatus: guestRsvpStatus.value,
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const selectAll = event.target.closest("[data-guest-select-all]");
  if (selectAll) {
    toggleAllVisibleGuests(selectAll.checked);
    renderActiveView();
    return;
  }

  const libraryFilter = event.target.closest("[data-library-filter]");
  if (libraryFilter) {
    const key = libraryFilter.dataset.libraryFilter;
    state.libraryFilters[key] =
      libraryFilter.type === "checkbox"
        ? libraryFilter.checked
        : libraryFilter.value;
    renderActiveView();
  }
}

function handleDocumentKeydown(event) {
  if (
    event.key === "Tab" &&
    state.sidebarOpen &&
    window.matchMedia("(max-width: 1180px)").matches
  ) {
    const focusable = [
      ...elements.dashboardSidebar.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }

  const seatingTab = event.target.closest(".seating-panel-tabs [role='tab']");
  if (seatingTab && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const tabs = [
      ...seatingTab.parentElement.querySelectorAll(
        "[role='tab']:not([disabled])",
      ),
    ];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const currentIndex = tabs.indexOf(seatingTab);
    const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
    nextTab?.focus();
    nextTab?.click();
    return;
  }

  if (
    state.activeGuestMenu &&
    ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
  ) {
    handleGuestMenuKeyboard(event);
    return;
  }

  if (event.key !== "Escape") {
    return;
  }

  if (state.activeGuestMenu) {
    closeGuestMenu();
    return;
  }

  if (state.sidebarOpen) {
    closeMobileSidebar();
  }
}

function loadDemoDashboard(
  message = "Preview mode is on. Firebase setup can be added later.",
) {
  state.mode = "demo";
  state.permissions = {
    role: "Demo Admin",
    canViewDashboard: true,
    canEditGuests: true,
    canEditSeating: true,
    canCheckIn: true,
    canExport: true,
    canManageUsers: true,
  };
  state.wedding = demoWedding;
  const savedDemoState = readDemoDashboardState();
  state.deletedSeedGuestIds = Array.isArray(savedDemoState?.deletedSeedGuestIds)
    ? savedDemoState.deletedSeedGuestIds
    : [];
  const demoSourceGuests = mergeDemoSeedGuests(savedDemoState?.guests || []);
  state.guests = demoSourceGuests.map((guest) => ({
    ...guest,
    additionalGuests: normalizeAdditionalGuests(guest.additionalGuests),
    // Rebuild public URLs from the current host. Saved links can contain an
    // old development address that is no longer running.
    inviteLink: buildInviteLink(guest.guestToken),
    qrCodeValue: guest.qrCodeValue || buildCheckinLink(guest.guestToken),
  }));
  state.loadingGuests = false;
  state.tables = hydrateTables(
    uniqueRowsById(savedDemoState?.tables || demoTables, "demo table"),
  );
  state.guests = syncGuestSeatingSummaries(state.guests, state.tables);
  state.hallObjects = hydrateHallObjects(savedDemoState?.hallObjects);
  state.loadingTables = false;
  state.selectedTableId = state.tables[0]?.id || "";
  showDashboard();
  renderAll();
  showToast(message, "info");
}

function mergeDemoSeedGuests(savedGuests) {
  const uniqueSavedGuests = uniqueRowsById(savedGuests, "demo guest");
  const savedById = new Map(uniqueSavedGuests.map((guest) => [guest.id, guest]));
  const deletedSeedIds = new Set(state.deletedSeedGuestIds || []);
  const merged = demoSeedGuests
    .filter((seedGuest) => !deletedSeedIds.has(seedGuest.id))
    .map((seedGuest) => ({
      ...seedGuest,
      ...(savedById.get(seedGuest.id) || {}),
    }));
  const customGuests = uniqueSavedGuests.filter(
    (guest) => !demoSeedGuests.some((seedGuest) => seedGuest.id === guest.id),
  );
  return uniqueRowsById([...merged, ...customGuests], "demo guest");
}

function uniqueRowsById(rows, label = "document") {
  const byId = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = String(row?.id || "").trim();
    if (!id) {
      console.warn(`Ignoring ${label} without a document ID.`, row);
      return;
    }
    byId.set(id, { ...row, id });
  });
  return [...byId.values()];
}

function readDemoDashboardState() {
  try {
    const saved = localStorage.getItem(demoDashboardStorageKey);
    if (!saved) {
      return null;
    }
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed.guests) && Array.isArray(parsed.tables)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function persistDemoDashboardState() {
  if (state.mode !== "demo") {
    return;
  }
  localStorage.setItem(
    demoDashboardStorageKey,
    JSON.stringify({
      guests: state.guests,
      tables: state.tables,
      hallObjects: state.hallObjects,
      deletedSeedGuestIds: state.deletedSeedGuestIds || [],
    }),
  );
}

async function bootstrapDashboard() {
  const permissionDoc = await getDoc(
    doc(
      state.services.db,
      "weddings",
      state.weddingId,
      "dashboardUsers",
      state.currentUser.uid,
    ),
  );

  if (!permissionDoc.exists() || !permissionDoc.data().canViewDashboard) {
    redirectToLogin("access-denied");
    return;
  }

  state.permissions = permissionDoc.data();
  // Seat-only accounts are always routed into the simplified editor, even
  // when they open the regular dashboard address directly.
  if (state.permissions.seatingOnly === true) {
    state.editorMode = true;
    state.secureEditorMode = false;
  } else if (accountSeatingEditorMode) {
    // Owners and regular dashboard users can use the seating sign-in URL as a
    // shortcut to the Seating view without being mistaken for restricted staff.
    state.activeView = "seating";
  }
  if (state.editorMode) {
    const allowedSide = String(state.permissions.allowedSide || "")
      .trim()
      .toLowerCase();
    if (
      !state.permissions.canEditSeating ||
      !["bride", "groom", "all"].includes(allowedSide) ||
      (requestedSeatingSide && allowedSide !== "all" && requestedSeatingSide !== allowedSide)
    ) {
      redirectToLogin("access-denied");
      return;
    }
    // `allowedSide` is a permission, not a URL preference.  The URL may only
    // repeat it; Firestore applies the same restriction for every write.
    state.editorRole = allowedSide;
    state.activeView = "seating";
  }
  rememberWeddingId(state.weddingId);
  const weddingDoc = await getDoc(
    doc(state.services.db, "weddings", state.weddingId),
  );
  state.wedding = weddingDoc.exists()
    ? { ...weddingDoc.data(), id: weddingDoc.id }
    : null;
  if (state.activeView === "guestSummary" && !canViewGuestSummary()) {
    state.activeView = "overview";
  }
  if (state.activeView === "checkin" && !isInvitationQrEnabled()) {
    state.activeView = "overview";
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("view");
    window.history.replaceState(null, "", nextUrl);
  }
  if (state.editorMode && isCelebrationEvent(state.wedding)) {
    redirectToLogin("access-denied");
    return;
  }
  state.hallObjects = hydrateHallObjects(state.wedding?.hallObjects);
  if (state.wedding?.seatingEnabled === false && state.activeView === "seating" && !state.editorMode) {
    state.activeView = "overview";
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("view");
    window.history.replaceState(null, "", nextUrl);
  }
  showDashboard();
  renderAll();
  startWeddingListener();
  startListeners();
  startSeatingAccessListener();
  // A migration outage must not delay dashboard rendering or live data.
  void normalizeGuestSidesInBackground();
}

async function normalizeGuestSidesInBackground() {
  if (!can("canEditGuests") || state.mode !== "live") return;
  const generation = state.listenerGeneration;
  try {
    const guestsSnapshot = await getDocs(
      collection(state.services.db, "weddings", state.weddingId, "guests"),
    );
    const legacyGuests = guestsSnapshot.docs.filter((guestDoc) =>
      isLegacyBothGuestSide(guestDoc.data().side),
    );
    for (let offset = 0; offset < legacyGuests.length; offset += 400) {
      const batch = writeBatch(state.services.db);
      legacyGuests.slice(offset, offset + 400).forEach((guestDoc) => {
        batch.update(guestDoc.ref, {
          side: "groom",
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
    if (generation !== state.listenerGeneration) return;
    if (legacyGuests.length) {
      showToast(
        `Updated ${legacyGuests.length} legacy guest side assignment${legacyGuests.length === 1 ? "" : "s"} to Groom.`,
        "success",
      );
    }
  } catch (error) {
    console.error("Legacy guest-side migration failed.", error);
    if (generation !== state.listenerGeneration) return;
    showToast("We could not update all legacy guest side assignments. Please refresh and try again.", "error");
  }
}

function isWeddingOwner() {
  return Boolean(
    state.currentUser?.uid &&
      state.wedding?.ownerUserId === state.currentUser.uid,
  );
}

function canEditEventDetails() {
  return isWeddingOwner() || can("canEditEventDetails");
}

function canManageSeatingAccess() {
  return isWeddingOwner() || state.permissions?.canManageUsers === true;
}

function startSeatingAccessListener() {
  state.unsubSeatingAccess?.();
  state.unsubSeatingAccess = null;
  if (!canManageSeatingAccess()) {
    state.seatingAccess = { bride: null, groom: null, family: null };
    return;
  }
  state.unsubSeatingAccess = onSnapshot(
    collection(state.services.db, "weddings", state.weddingId, "seatingAccess"),
    (snapshot) => {
      const next = { bride: null, groom: null, family: null };
      snapshot.docs.forEach((item) => {
        if (["bride", "groom", "family"].includes(item.id))
          next[item.id] = { id: item.id, ...item.data() };
      });
      state.seatingAccess = next;
      if (state.activeView === "share") renderActiveView();
    },
  );
}

function startListeners() {
  state.unsubGuests?.();
  state.unsubTables?.();
  state.unsubGuests = null;
  state.unsubTables = null;
  const generation = ++state.listenerGeneration;
  state.loadingGuests = true;
  state.loadingTables = true;
  renderActiveView();

  const guestSource = state.editorMode && state.editorRole !== "all"
    ? query(
        collection(state.services.db, "weddings", state.weddingId, "guests"),
        where("side", "in", editorGuestSideValues(state.editorRole)),
      )
    : collection(state.services.db, "weddings", state.weddingId, "guests");
  state.unsubGuests = onSnapshot(
    guestSource,
    (snapshot) => {
      if (generation !== state.listenerGeneration) return;
      state.guests = uniqueRowsById(snapshot.docs.map((docSnapshot) => ({
        ...docSnapshot.data(),
        id: docSnapshot.id,
        side: normalizeGuestSide(docSnapshot.data().side),
      })), "Firestore guest");
      state.firestoreGuestCount = snapshot.size;
      state.firestoreGuestIds = snapshot.docs.map(
        (docSnapshot) => docSnapshot.id,
      );
      console.info("[Dashboard Firestore diagnostics]", {
        projectId: state.services.config.projectId,
        weddingId: state.weddingId,
        demoMode: state.mode === "demo",
        firestoreGuestCount: state.firestoreGuestCount,
        firestoreGuestIds: state.firestoreGuestIds,
      });
      state.loadingGuests = false;
      renderAll();
      if (!state.publicMirrorsReconciled && can("canEditGuests")) {
        state.publicMirrorsReconciled = true;
        void reconcilePublicGuestMirrors(state.guests);
      }
      void syncPublicStats();
    },
    (error) => handleSeatingListenerError(error),
  );

  state.unsubTables = onSnapshot(
    collection(state.services.db, "weddings", state.weddingId, "tables"),
    (snapshot) => {
      if (generation !== state.listenerGeneration) return;
      state.tables = hydrateTables(
        uniqueRowsById(snapshot.docs.map((docSnapshot) => ({
          ...docSnapshot.data(),
          id: docSnapshot.id,
        })), "Firestore table"),
      );
      state.selectedTableId =
        state.selectedTableId || state.tables[0]?.id || "";
      state.loadingTables = false;
      renderAll();
      void syncPublicStats();
    },
    (error) => handleSeatingListenerError(error),
  );
}

function startWeddingListener() {
  state.unsubWedding?.();
  state.unsubWedding = onSnapshot(
    doc(state.services.db, "weddings", state.weddingId),
    (snapshot) => {
      if (!snapshot.exists()) {
        redirectToLogin("access-denied");
        return;
      }
      const nextWedding = { ...snapshot.data(), id: snapshot.id };
      if (state.editorMode && isCelebrationEvent(nextWedding)) {
        redirectToLogin("access-denied");
        return;
      }
      state.wedding = nextWedding;
      state.hallObjects = hydrateHallObjects(state.wedding.hallObjects);
      if (!isSeatingEnabled() && state.activeView === "seating" && !state.editorMode) {
        state.activeView = "overview";
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("view");
        window.history.replaceState(null, "", nextUrl);
      }
      if (!isInvitationQrEnabled() && state.activeView === "checkin" && !state.editorMode) {
        state.activeView = "overview";
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("view");
        window.history.replaceState(null, "", nextUrl);
      }
      const focusedSetting = document.activeElement?.dataset?.action;
      const pageScroll = { x: window.scrollX, y: window.scrollY };
      renderAll();
      if (["toggle-event-qr", "toggle-event-seating"].includes(focusedSetting)) {
        requestAnimationFrame(() => {
          document.querySelector(`[data-action="${focusedSetting}"]`)?.focus({ preventScroll: true });
          if (window.scrollX !== pageScroll.x || window.scrollY !== pageScroll.y) {
            window.scrollTo(pageScroll.x, pageScroll.y);
          }
        });
      }
    },
    (error) => {
      console.error("Live event settings could not be loaded.", error);
      showToast("Live event settings could not be loaded. Please refresh.", "error");
    },
  );
}

function disposeDashboardListeners() {
  state.listenerGeneration += 1;
  state.unsubGuests?.();
  state.unsubTables?.();
  state.unsubWedding?.();
  state.unsubSeatingAccess?.();
  state.unsubAuth?.();
  state.unsubGuests = null;
  state.unsubTables = null;
  state.unsubWedding = null;
  state.unsubSeatingAccess = null;
  state.unsubAuth = null;
}

function handleSeatingListenerError(error) {
  console.error(error);
  if (state.editorMode && error?.code === "permission-denied") {
    state.unsubGuests?.();
    state.unsubTables?.();
    state.unsubGuests = null;
    state.unsubTables = null;
    showEditorAccessError();
    return;
  }
  showToast(
    "Live seating updates could not be loaded. Please refresh.",
    "error",
  );
}

// Side-status pages mirror the Guest Directory's side field exactly so their
// counts always match the corresponding guest category.
function sideViewMatches(guest, side) {
  return normalizeGuestSide(guest.side) === side;
}

function normalizeGuestSide(value) {
  const side = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, " ");
  if (side === "general") return "general";
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side"].includes(side)) return "groom";
  if (["both", "both sides", "shared"].includes(side)) return "groom";
  return "family";
}

function isLegacyBothGuestSide(value) {
  const side = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, " ");
  return ["both", "both sides", "shared"].includes(side);
}

function editorGuestSideValues(role) {
  const aliases = {
    bride: ["bride", "Bride", "bride side", "Bride Side", "brides side"],
    groom: ["groom", "Groom", "groom side", "Groom Side", "grooms side"],
    family: ["family", "Family", "family side", "Family Side"],
  };
  return role === "family"
    ? aliases.family
    : [
        ...aliases[role],
        ...(role === "groom"
          ? ["both", "Both", "both sides", "Both Sides", "shared", "Shared"]
          : []),
      ];
}

function buildPublicStatsPayload() {
  if (isCelebrationEvent(state.wedding)) {
    const guests = state.guests;
    const confirmed = guests.filter((guest) => guest.rsvpStatus === "confirmed");
    const members = {
      invited: guests.length,
      seats: guests.reduce((sum, guest) => sum + getPartySize(guest), 0),
      confirmed: confirmed.length,
      confirmedSeats: confirmed.reduce((sum, guest) => sum + getPartySize(guest), 0),
      pending: guests.filter((guest) => !["confirmed", "declined"].includes(guest.rsvpStatus)).length,
      declined: guests.filter((guest) => guest.rsvpStatus === "declined").length,
      seated: guests.filter((guest) => getGuestAssignedSeats(guest.id).length > 0).length,
      invitesSent: guests.filter((guest) => guest.inviteSentAt || guest.reminderSentAt).length,
    };
    const roster = guests.map((guest) => ({
      id: guest.id, n: guest.fullName || "",
      r: ["confirmed", "declined"].includes(guest.rsvpStatus) ? guest.rsvpStatus : "pending",
      p: getPartySize(guest),
      seats: getGuestAssignedSeats(guest.id).map((assignment) => ({ t: assignment.tableName || "", n: Number(assignment.seatNumber) || 0 })),
    }));
    return { eventCategory: "celebration", eventTitle: getEventDisplayTitle(state.wedding), all: members, roster: { all: roster } };
  }
  const sides = {};
  const roster = {};
  ["groom", "bride", "family"].forEach((side) => {
    const guests = state.guests.filter((guest) => sideViewMatches(guest, side));
    const confirmed = guests.filter(
      (guest) => guest.rsvpStatus === "confirmed",
    );
    sides[side] = {
      invited: guests.length,
      seats: guests.reduce((sum, guest) => sum + getPartySize(guest), 0),
      confirmed: confirmed.length,
      confirmedSeats: confirmed.reduce(
        (sum, guest) => sum + getPartySize(guest),
        0,
      ),
      pending: guests.filter(
        (guest) => !["confirmed", "declined"].includes(guest.rsvpStatus),
      ).length,
      declined: guests.filter((guest) => guest.rsvpStatus === "declined")
        .length,
      seated: guests.filter(
        (guest) => getGuestAssignedSeats(guest.id).length > 0,
      ).length,
      invitesSent: guests.filter(
        (guest) => guest.inviteSentAt || guest.reminderSentAt,
      ).length,
    };
    roster[side] = guests.map((guest) => ({
      id: guest.id,
      n: guest.fullName || "",
      r: ["confirmed", "declined"].includes(guest.rsvpStatus)
        ? guest.rsvpStatus
        : "pending",
      p: getPartySize(guest),
      seats: getGuestAssignedSeats(guest.id).map((assignment) => ({
        t: assignment.tableName || "",
        n: Number(assignment.seatNumber) || 0,
      })),
    }));
  });
  return { eventCategory: "wedding_engagement", eventTitle: getEventDisplayTitle(state.wedding), coupleName: state.wedding?.coupleName || "", sides, roster };
}

let lastPublicStatsJson = "";

// Publishes side-level stats to a public doc the standalone side.html pages
// read. Runs on every snapshot delivery; the JSON compare keeps it from
// writing unless something actually changed.
async function syncPublicStats() {
  if (
    state.mode !== "live" ||
    !state.weddingId ||
    !state.services?.db ||
    !can("canViewDashboard")
  ) {
    return;
  }
  if (state.loadingGuests || state.loadingTables) {
    return;
  }
  const payload = buildPublicStatsPayload();
  const json = JSON.stringify(payload);
  if (json === lastPublicStatsJson) {
    return;
  }
  lastPublicStatsJson = json;
  try {
    await setDoc(
      doc(
        state.services.db,
        "weddings",
        state.weddingId,
        "publicStats",
        "summary",
      ),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
    );
  } catch (error) {
    lastPublicStatsJson = "";
    console.error("Side status page sync failed.", error);
  }
}

function showDashboard() {
  elements.dashboardApp.hidden = false;
}

function renderAll() {
  closeGuestMenu({ restoreFocus: false });
  const weddingSideControls = document.querySelectorAll("[data-wedding-side-control]");
  weddingSideControls.forEach((label) => {
    label.hidden = !eventUsesGuestSides(state.wedding);
    const select = label.querySelector("select");
    if (select) select.disabled = !eventUsesGuestSides(state.wedding);
  });
  document.body.classList.toggle("is-celebration-event", isCelebrationEvent(state.wedding));
  renderChrome();
  renderActiveView();
  // The standalone side/invitation pages read the public side summary.  A
  // seating action updates local state before its listener round-trip arrives,
  // so publish from the same authoritative table state immediately as well.
  void syncPublicStats();
}

function renderChrome() {
  const meta = pageMeta[state.activeView];
  const isSeatingView = state.activeView === "seating";
  const isOverviewView = state.activeView === "overview";
  document.body.classList.toggle("is-seating-view", isSeatingView);
  document.body.classList.toggle("is-overview-view", isOverviewView);
  document.body.classList.toggle("is-guests-view", state.activeView === "guests");
  document.body.classList.toggle("is-seating-editor", state.editorMode);
  elements.dashboardSidebar.hidden = state.secureEditorMode;
  elements.dashboardSidebar.classList.toggle(
    "is-seating-only",
    state.editorMode && !state.secureEditorMode,
  );
  if (elements.allEventsNavLink) {
    elements.allEventsNavLink.hidden = state.editorMode;
  }
  elements.signOutButton.textContent = state.editorMode
    ? "End session"
    : "Sign out";
  if (elements.signedInUserName) {
    elements.signedInUserName.textContent = signedInUserName();
  }
  elements.pageEyebrow.textContent = state.editorMode
    ? "Secure shared workspace"
    : isSeatingView
      ? ""
      : meta.eyebrow;
  elements.pageTitle.textContent = state.editorMode
    ? `${state.editorRole === "all" ? "All sides" : `${state.editorRole[0].toUpperCase()}${state.editorRole.slice(1)}`} — Seating Editor`
    : isSeatingView
      ? ""
      : meta.title;
  elements.pageDescription.textContent = state.editorMode
    ? "Changes are synchronized live with the event dashboard."
    : isSeatingView
      ? ""
      : isOverviewView
        ? ""
        : meta.description;
  elements.pageDescription.hidden = !elements.pageDescription.textContent;
  elements.liveIndicator.textContent =
    state.mode === "demo"
      ? "Preview mode"
      : "";
  elements.liveIndicator.hidden = !elements.liveIndicator.textContent;

  document.querySelectorAll("[data-nav-view]").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.navView === state.activeView,
    );
    if (button.dataset.navView === "seating") button.hidden = !isSeatingEnabled();
    if (button.dataset.navView === "checkin") {
      button.hidden = !isInvitationQrEnabled();
    }
    if (button.dataset.navView === "guestSummary") {
      button.hidden = !canViewGuestSummary() || state.editorMode;
    }
  });

  updateSidebarState();
  renderGlobalActions();
}

function updateSidebarState() {
  const isMobile = window.matchMedia("(max-width: 1180px)").matches;
  if (!isMobile && state.sidebarOpen) state.sidebarOpen = false;
  elements.dashboardSidebar.classList.toggle("is-open", state.sidebarOpen);
  elements.dashboardApp.classList.toggle(
    "is-sidebar-collapsed",
    !isMobile && state.sidebarCollapsed && !state.secureEditorMode,
  );
  if (elements.navToggleButton) {
    elements.navToggleButton.setAttribute(
      "aria-expanded",
      String(state.sidebarOpen),
    );
    elements.navToggleButton.setAttribute(
      "aria-label",
      state.sidebarOpen ? "Close navigation" : "Open navigation",
    );
  }
  if (elements.seatingMobileNavButton) {
    const isSeatingMobile = isMobile && state.activeView === "seating" && !state.secureEditorMode;
    elements.seatingMobileNavButton.hidden = !isSeatingMobile;
    elements.seatingMobileNavButton.setAttribute(
      "aria-expanded",
      String(state.sidebarOpen),
    );
    elements.seatingMobileNavButton.setAttribute(
      "aria-label",
      state.sidebarOpen ? "Close navigation" : "Open navigation",
    );
  }
  if (elements.desktopSidebarToggleButton) {
    elements.desktopSidebarToggleButton.hidden = state.secureEditorMode;
    elements.desktopSidebarToggleButton.setAttribute(
      "aria-expanded",
      String(!state.sidebarCollapsed),
    );
    elements.desktopSidebarToggleButton.textContent = state.sidebarCollapsed
      ? "Expand navigation"
      : "Collapse navigation";
  }
  if (elements.desktopSidebarExpandButton) {
    elements.desktopSidebarExpandButton.hidden = true;
  }
  if (elements.desktopSidebarToggleButton) {
    const label = state.sidebarCollapsed ? "Expand navigation" : "Collapse navigation";
    elements.desktopSidebarToggleButton.title = label;
    elements.desktopSidebarToggleButton.setAttribute("aria-label", label);
  }
}

function toggleMobileSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  updateSidebarState();
  if (state.sidebarOpen) elements.sidebarCloseButton?.focus();
}

function closeMobileSidebar() {
  if (!state.sidebarOpen) return;
  state.sidebarOpen = false;
  updateSidebarState();
  (state.activeView === "seating"
    ? elements.seatingMobileNavButton
    : elements.navToggleButton)?.focus();
}

function loadDesktopSidebarPreference() {
  try {
    return window.localStorage.getItem(dashboardSidebarStorageKey) === "1";
  } catch {
    return false;
  }
}

function refreshPlannerAfterSidebarChange() {
  requestAnimationFrame(() => {
    const viewport = document.getElementById("plannerViewport");
    if (!viewport || state.activeView !== "seating") return;
    const nextWidth = Math.max(viewport.clientWidth, 820);
    if (Math.abs(nextWidth - state.plannerMapWidth) >= 2) {
      renderActiveView();
      return;
    }
    restorePlannerViewport();
  });
}

function renderGlobalActions() {
  const actions = [];
  if (state.editorMode) {
    elements.globalActions.innerHTML = "";
    return;
  }
  if (state.activeView === "overview") {
    actions.push(`
      <button class="da3wa-button da3wa-button--secondary overview-refresh-button" type="button" data-action="reload-dashboard" aria-label="Refresh page" title="Refresh page">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" /></svg>
      </button>
    `);
    elements.globalActions.innerHTML = actions.join("");
    return;
  }
  if (state.activeView !== "seating" && state.activeView !== "guests") {
    actions.push(
      actionButton("Refresh", "refresh-dashboard", false, "secondary"),
    );
  }

  elements.globalActions.innerHTML = actions.join("");
}

function renderOverviewMoreActions() {
  return `
    <details class="overview-actions-menu">
      <summary class="da3wa-button da3wa-button--secondary">More actions</summary>
      <div class="overview-actions-menu__panel" role="menu" aria-label="More overview actions">
        ${overviewMenuButton("Refresh", "refresh-dashboard")}
        ${overviewMenuButton("Export guest list", "export-all", !can("canExport"))}
        ${overviewMenuButton("Copy invitation link", "copy-invitation-base")}
        ${overviewMenuButton("Open check-in", "open-checkin")}
      </div>
    </details>
  `;
}

function overviewMenuButton(label, action, disabled = false) {
  return `<button class="overview-actions-menu__item" type="button" role="menuitem" data-action="${escapeAttribute(action)}" ${disabled ? 'disabled aria-disabled="true"' : ""}>${escapeHtml(label)}</button>`;
}

function switchView(view) {
  if (state.dirtyEventSettings && view !== state.activeView) {
    if (!window.confirm("Discard unsaved event detail changes and leave Event Settings?")) {
      return;
    }
    state.dirtyEventSettings = false;
    state.eventSettingsMessage = "";
  }
  if (state.editorMode && view !== "seating") return;
  if (view === "guestSummary" && !canViewGuestSummary()) return;
  if (view === "checkin" && !isInvitationQrEnabled()) return;
  if (view === "seating" && !isSeatingEnabled()) {
    showToast("Seating is disabled for this event.", "info");
    return;
  }
  if (!pageMeta[view]) {
    return;
  }
  closeGuestMenu({ restoreFocus: false });
  state.activeView = view;
  const closeDrawer = state.sidebarOpen;
  state.sidebarOpen = false;
  if (!state.editorMode) {
    const nextUrl = new URL(window.location.href);
    if (view === "overview") {
      nextUrl.searchParams.delete("view");
    } else {
      nextUrl.searchParams.set("view", view);
    }
    window.history.replaceState(null, "", nextUrl);
  }
  renderAll();
  if (closeDrawer && window.matchMedia("(max-width: 1180px)").matches) {
    (view === "seating"
      ? elements.seatingMobileNavButton
      : elements.navToggleButton)?.focus();
  }
}

function renderActiveView() {
  switch (state.activeView) {
    case "overview":
      renderOverviewPage();
      break;
    case "guestSummary":
      if (canViewGuestSummary()) renderGuestSummaryPage();
      else renderOverviewPage();
      break;
    case "guests":
      renderGuestPage();
      break;
    case "settings":
      renderEventSettingsPage();
      break;
    case "seating":
      renderSeatingPage();
      break;
    case "checkin":
      renderCheckinPage();
      break;
    case "share":
      renderSharePage();
      break;
    case "exports":
      renderExportsPage();
      break;
    default:
      renderOverviewPage();
  }
}

function canViewGuestSummary() {
  const role = String(state.permissions?.role || "").trim().toLowerCase();
  return Boolean(
    isWeddingOwner() || ["owner", "customer", "client"].includes(role),
  );
}

function renderGuestSummaryPage() {
  if (state.loadingGuests || state.loadingTables) {
    elements.pageContent.innerHTML =
      '<div class="da3wa-skeleton" aria-hidden="true"></div>';
    return;
  }

  const stats = calculateDashboardStats(state.guests, state.tables);
  elements.pageContent.innerHTML = `
    <section class="overview-page guest-summary-page">
      <section class="overview-kpis overview-kpis--no-seating" aria-label="Guest totals">
        ${renderKpiCard("Total guests", stats.totalPeople, `${stats.total} invitations`, "Including additional guests")}
        ${renderKpiCard("Confirmed", stats.confirmed, `${stats.confirmedPct}% of invitation groups`, "RSVP accepted")}
        ${renderKpiCard("Awaiting reply", stats.pending, "Still need an RSVP", "Pending")}
        ${renderKpiCard("Declined", stats.declined, `${stats.declinedPct}% of invitation groups`, "Unable to attend")}
      </section>
    </section>
  `;
}

function renderOverviewPage() {
  if (state.loadingGuests || state.loadingTables) {
    elements.pageContent.innerHTML =
      '<div class="da3wa-skeleton" aria-hidden="true"></div>';
    return;
  }

  const stats = calculateDashboardStats(state.guests, state.tables);
  const seatingEnabled = isSeatingEnabled();
  const attention = calculateAttention(state.guests, state.tables, seatingEnabled);
  const recentActivity = deriveRecentActivity(state.guests);
  const sideStats = calculateSideStats(state.guests, state.tables);
  const sideDistribution = eventUsesGuestSides(state.wedding)
    ? `<article class="overview-card overview-distribution"><p class="da3wa-eyebrow">Guest distribution</p><h2>By invitation side</h2><div class="overview-table-wrap"><table class="overview-distribution__table"><thead><tr><th scope="col">Side</th><th scope="col">Invited</th><th scope="col">Confirmed</th><th scope="col">Pending</th><th scope="col">Seating</th></tr></thead><tbody>${renderDistributionRow("Groom", sideStats.groom)}${renderDistributionRow("Bride", sideStats.bride)}${renderDistributionRow("Family", sideStats.other)}</tbody></table></div></article>`
    : `<article class="overview-card overview-distribution"><p class="da3wa-eyebrow">Guest summary</p><h2>Overall RSVP totals</h2><div class="overview-seating-summary overview-seating-summary--totals"><div><strong>${stats.total}</strong><span>Guests invited</span></div><div><strong>${stats.confirmed}</strong><span>Confirmed</span></div><div><strong>${stats.pending}</strong><span>Awaiting reply</span></div><div><strong>${stats.declined}</strong><span>Declined</span></div></div></article>`;

  elements.pageContent.innerHTML = `
    <section class="overview-page">
      <div class="overview-event-details" aria-label="Event details">
        <div class="overview-event-detail">
          <span>Event</span>
          <strong>${escapeHtml(getEventDisplayTitle(state.wedding))}</strong>
        </div>
        <div class="overview-event-detail">
          <span>Status</span>
          <strong class="overview-event-status">${escapeHtml(prettifyShape(state.wedding?.status || "active"))}</strong>
        </div>
        <div class="overview-event-detail">
          <span>Date &amp; time</span>
          <strong>${escapeHtml(formatEventDate(state.wedding?.eventDateISO))}</strong>
        </div>
        <div class="overview-event-detail">
          <span>Location</span>
          <strong>${escapeHtml(state.wedding?.venueEn || "Venue not set")}</strong>
        </div>
      </div>
      <section class="overview-kpis${seatingEnabled ? "" : " overview-kpis--no-seating"}" aria-label="Event summary">
        ${renderKpiCard("Total invited", stats.total, `${stats.totalPeople} people total`, `${stats.accompanyingGuests} additional`)}
        ${renderKpiCard("Confirmed", stats.confirmed, `${stats.confirmedPct}% of parties`, "RSVP accepted")}
        ${renderKpiCard("Pending", stats.pending, `${stats.pendingPct}% of parties`, "Awaiting reply")}
        ${seatingEnabled ? renderKpiCard("Seating attention", stats.withoutSeat, `${stats.withoutSeatPct}% of confirmed`, "Parties need seats") : ""}
        ${renderKpiCard("Checked in", stats.checkedIn, `${stats.checkinPct}% arrived`, "Venue arrivals")}
      </section>

      <section class="overview-operational${seatingEnabled ? "" : " overview-operational--no-seating"}" aria-label="Event operations">
        <article class="overview-card overview-card--attention">
          <p class="da3wa-eyebrow">Needs attention</p>
          <h2>Actionable issues</h2>
          <div class="attention-list">
            ${attention.length
              ? attention.map((item) => `
                  <div class="attention-item">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(item.description)}</span>
                  </div>
                `).join("")
              : `<div class="overview-empty-state"><strong>Everything is in good shape</strong><span>No RSVP, ${seatingEnabled ? "seating, " : ""}capacity, or profile issues need attention right now.</span></div>`}
          </div>
        </article>

        <article class="overview-card overview-card--rsvp">
          <p class="da3wa-eyebrow">RSVP status</p>
          <h2>Response progress</h2>
          <div class="progress-stack">
            ${progressRow("Confirmed", stats.confirmed, stats.total, "sage")}
            ${progressRow("Pending", stats.pending, stats.total, "amber")}
            ${progressRow("Declined", stats.declined, stats.total, "rose")}
          </div>
          <p class="overview-card__supporting">${stats.declined} declined · ${stats.declinedPct}% of invited parties</p>
        </article>

        ${seatingEnabled ? `<article class="overview-card overview-card--seating">
          <p class="da3wa-eyebrow">Seating readiness</p>
          <h2>Floor plan capacity</h2>
          <div class="overview-seating-summary">
            <div><strong>${stats.assignedSeats}</strong><span>Assigned seats</span></div>
            <div><strong>${stats.withoutSeat}</strong><span>Confirmed parties needing seats</span></div>
            <div><strong>${stats.remainingSeats}</strong><span>Available seats</span></div>
          </div>
        </article>` : ""}
      </section>

      <section class="overview-lower" aria-label="Guest detail">
        ${sideDistribution}

        <article class="overview-card overview-activity">
          <p class="da3wa-eyebrow">Recent activity</p>
          <h2>Latest movement</h2>
          <div class="activity-list">
            ${
              recentActivity.length
                ? recentActivity
                    .map(
                      (item) => `
                      <div class="activity-item">
                        <strong>${escapeHtml(item.title)}</strong>
                        <span>${escapeHtml(item.subtitle)}</span>
                      </div>
                    `,
                    )
                    .join("")
                : `<div class="overview-empty-state"><strong>No recent activity yet</strong><span>RSVP, check-in, and reminder updates will appear here.</span></div>`
            }
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderGuestPage() {
  if (state.loadingGuests) {
    elements.pageContent.innerHTML =
      '<section class="guest-page"><div class="da3wa-skeleton" aria-hidden="true"></div></section>';
    return;
  }

  const guests = getFilteredGuests();
  const directoryCounts = calculateGuestDirectoryCounts(state.guests);
  const filteredCounts = calculateGuestDirectoryCounts(guests);
  const totalGuestPages = Math.max(
    1,
    Math.ceil(guests.length / guestDirectoryPageSize),
  );
  state.guestPageIndex = clamp(state.guestPageIndex, 0, totalGuestPages - 1);
  const pageStart = state.guestPageIndex * guestDirectoryPageSize;
  const visibleGuests = guests.slice(
    pageStart,
    pageStart + guestDirectoryPageSize,
  );
  const selectedCount = state.selectedGuestIds.length;
  const usesSides = eventUsesGuestSides(state.wedding);
  const anySelectedVisible = guests.some((guest) =>
    state.selectedGuestIds.includes(guest.id),
  );

  elements.pageContent.innerHTML = `
    <section class="guest-page">
      <article class="guest-toolbar">
        <div class="guest-toolbar__filters ${usesSides ? "guest-toolbar__filters--with-sides" : "guest-toolbar__filters--single-filter"}">
          <div class="guest-toolbar__controls">
            <input class="da3wa-input guest-toolbar__search" type="search" placeholder="Search name or phone" value="${escapeAttribute(state.guestFilters.search)}" data-guest-search aria-label="Search guests by name or phone" />
            ${selectInput("rsvp", state.guestFilters.rsvp, [
              ["all", "All RSVP"],
              ["confirmed", "Confirmed"],
              ["pending", "Pending"],
              ["declined", "Declined"],
            ])}
            ${usesSides ? selectInput("side", state.guestFilters.side, [
              ["all", "All Sides"],
              ["bride", "Bride"],
              ["groom", "Groom"],
              ["family", "Family"],
            ]) : ""}
          </div>
          <span class="pill">${filteredCounts.primary} primary result${filteredCounts.primary === 1 ? "" : "s"}</span>
        </div>
      </article>

      ${
        selectedCount
          ? `
            <article class="guest-bulkbar">
              <div>
                <strong>${selectedCount} selected</strong>
                <p>${anySelectedVisible ? "Bulk actions apply to the currently selected guests." : "Selected guests may be outside the current filter."}</p>
              </div>
              <div class="guest-toolbar__summary">
                ${actionButton("Mark confirmed", "bulk-rsvp-confirmed", !can("canEditGuests"))}
                ${actionButton("Mark pending", "bulk-rsvp-pending", !can("canEditGuests"))}
                ${actionButton("Export selected", "bulk-export", !can("canExport"))}
              </div>
            </article>
          `
          : ""
      }

      <div class="guest-page-actions" aria-label="Guest actions">
        ${actionButton("Add guest", "open-add-guest", !can("canEditGuests"), "primary")}
        ${actionButton("Bulk add", "open-bulk-add", !can("canEditGuests"), "secondary")}
        ${actionButton("Refresh", "refresh-dashboard", false, "secondary")}
      </div>

      ${
        !guests.length
          ? `<div class="da3wa-empty">No guests match the current search and filters.</div>`
          : `
            <article class="da3wa-table guest-table-wrap">
              <table class="guest-table ${usesSides ? "guest-table--with-sides" : "guest-table--without-sides"}">
                <colgroup>
                  <col class="guest-table__selection-column" />
                  <col class="guest-table__name-column" />
                  <col class="guest-table__phone-column" />
                  <col class="guest-table__additional-column" />
                  ${usesSides ? '<col class="guest-table__side-column" />' : ""}
                  <col class="guest-table__rsvp-column" />
                  <col class="guest-table__actions-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th><input type="checkbox" data-guest-select-all ${allVisibleGuestsSelected(guests) ? "checked" : ""} aria-label="Select all visible guests" /></th>
                    <th>Guest</th>
                    <th>Phone</th>
                    <th>Additional guests</th>
                    ${usesSides ? "<th>Side</th>" : ""}
                    <th>RSVP</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${visibleGuests.map((guest) => renderGuestRow(guest)).join("")}
                </tbody>
              </table>
            </article>
            <article class="guest-page-controls" aria-label="Guest directory pages">
              <button class="da3wa-button da3wa-button--secondary" type="button" data-action="guest-page-prev" aria-label="Previous guest page" ${state.guestPageIndex === 0 ? 'disabled aria-disabled="true"' : ""}>←</button>
              <span>Showing ${pageStart + 1}-${Math.min(pageStart + guestDirectoryPageSize, guests.length)} of ${guests.length}</span>
              <button class="da3wa-button da3wa-button--secondary" type="button" data-action="guest-page-next" aria-label="Next guest page" ${state.guestPageIndex >= totalGuestPages - 1 ? 'disabled aria-disabled="true"' : ""}>→</button>
            </article>
            <div class="guest-cards">
              ${visibleGuests.map((guest) => renderGuestCard(guest)).join("")}
            </div>
          `
      }
    </section>
  `;
}

function renderSeatingPage() {
  if (!isSeatingEnabled()) {
    elements.pageContent.innerHTML = '<section class="seating-page"><article class="share-card"><p class="da3wa-eyebrow">Seating unavailable</p><h2>Seating is disabled for this event</h2><p>The event owner can enable seating again in Invitation settings. Existing tables and assignments are preserved.</p></article></section>';
    return;
  }
  if (state.loadingTables) {
    elements.pageContent.innerHTML =
      '<section class="seating-page"><div class="da3wa-skeleton" aria-hidden="true"></div></section>';
    return;
  }

  const selectedTable = getSelectedTable();
  const selectedHallObject = getSelectedHallObject();
  const seatingStats = calculateDashboardStats(state.guests, state.tables);
  const sideStats = calculateSideStats(state.guests, state.tables);
  const isSaving = state.saveState === "saving";
  const mobileLayout = window.matchMedia("(max-width: 700px)").matches;
  state.renderedMobileSeatingLayout = mobileLayout;
  if (mobileLayout) {
    renderMobileSeatingPage({ selectedTable, selectedHallObject, seatingStats, sideStats, isSaving });
    return;
  }
  const seatingPanelTab = state.seatingPanelTab;
  const oldViewport = document.getElementById("plannerViewport");
  const viewportWidth = oldViewport?.clientWidth ||
    document.querySelector(".planner-canvas-shell")?.clientWidth || 900;
  const mapWidth = Math.max(viewportWidth, 820);
  state.plannerMapWidth = mapWidth;
  if (
    state.activePartyGuestId &&
    !state.guests.some((guest) => guest.id === state.activePartyGuestId)
  ) {
    state.activePartyGuestId = "";
  }

  elements.pageContent.innerHTML = `
    <section class="seating-page">
      <article class="planner-toolbar">
        <div class="planner-status-heading"><p class="da3wa-eyebrow">Seating status</p><span>Live overview of guest and seat progress</span></div>
        <div class="planner-zoom-stats" aria-label="Planner status">
          ${renderPlannerStatCard(state.tables.length, "Tables")}
          ${renderPlannerStatCard(seatingStats.totalSeats, "Seats")}
          ${renderPlannerStatCard(seatingStats.total, "Guests")}
          ${renderPlannerStatCard(seatingStats.unassignedGuests, "Need seats")}
          ${eventUsesGuestSides(state.wedding) ? renderPlannerStatCard(`${sideStats.groom.seated}/${sideStats.groom.confirmed}`, "Groom seated", "groom") : renderPlannerStatCard(`${seatingStats.total - seatingStats.unassignedGuests}`, "Guests seated")}
          ${eventUsesGuestSides(state.wedding) ? renderPlannerStatCard(`${sideStats.bride.seated}/${sideStats.bride.confirmed}`, "Bride seated", "bride") : ""}
          <button class="planner-save-status ${isSaving ? "is-saving" : "is-saved"}" type="button" disabled aria-live="polite" aria-label="${isSaving ? "Saving seating changes" : "All seating changes saved"}">
            <span aria-hidden="true">${isSaving ? "↻" : "✓"}</span>${isSaving ? "Saving…" : "Saved"}
          </button>
        </div>
      </article>

      <div class="planner-layout${state.assignmentSession ? " has-assignment" : ""}">
        <article class="planner-canvas-shell">
          ${state.assignmentSession ? renderAssignmentControls() : ""}
          <div class="planner-canvas-controls">
            <div class="planner-canvas-controls__actions">
              <div class="planner-zoom-controls" aria-label="Planner zoom controls">
                ${actionButton("Zoom out", "planner-zoom-out", state.plannerZoom <= 0.7)}
                <span class="pill" data-zoom-percentage aria-live="polite">${Math.round(state.plannerZoom * 100)}%</span>
                ${actionButton("Zoom in", "planner-zoom-in", state.plannerZoom >= 1.6)}
                ${actionButton("Reset view", "planner-zoom-reset", false, "secondary")}
              </div>
              ${actionButton("Add table", "open-add-table", !canManageSeatingLayout(), "primary")}
              ${actionButton("Add dance floor", "open-add-dance-floor", !canManageSeatingLayout(), "primary")}
            </div>
          </div>
          <div class="planner-canvas-viewport" id="plannerViewport" aria-label="Venue map. Drag empty space to pan." tabindex="0">
            <div class="planner-map-extent">
              <div class="planner-canvas" id="plannerCanvas" style="width:${mapWidth}px;height:720px;--planner-zoom:${state.plannerZoom}">
                <div class="planner-canvas__floor"></div>
                ${state.hallObjects.map((item) => renderHallObject(item)).join("")}
                ${state.tables.length ? state.tables.map((table) => renderPlannerTable(table)).join("") : `<div class="da3wa-empty">No tables yet. Create your first table to start mapping the hall.</div>`}
              </div>
            </div>
          </div>
        </article>

        <aside class="planner-panel__stack" aria-label="Seating controls">
          <article class="planner-panel seating-side-panel">
            <div class="seating-side-panel__header">
              ${
                selectedHallObject
                  ? renderHallObjectInspector(selectedHallObject)
                  : selectedTable
                    ? renderTableInspector(selectedTable)
                    : `<div class="seating-panel-empty"><strong>No table selected</strong><span>Add or select a venue item to continue planning.</span></div>`
              }
            </div>
            <div class="seating-panel-tabs" role="tablist" aria-label="Seating sidebar">
              <button type="button" role="tab" aria-selected="${seatingPanelTab === "guests"}" class="${seatingPanelTab === "guests" ? "is-active" : ""}" data-action="set-seating-panel-tab" data-tab="guests" ${!state.tables.length ? 'disabled aria-disabled="true"' : ""}>Guests</button>
              <button type="button" role="tab" aria-selected="${seatingPanelTab === "venue"}" class="${seatingPanelTab === "venue" ? "is-active" : ""}" data-action="set-seating-panel-tab" data-tab="venue">Venue Items</button>
            </div>
            <div class="seating-side-panel__body" role="tabpanel">
              ${
                seatingPanelTab === "guests"
                  ? renderSeatingGuestsTab(selectedTable)
                  : renderLayoutLibrary()
              }
            </div>
          </article>
        </aside>
      </div>
    </section>
  `;

  document
    .getElementById("plannerCanvas")
    ?.addEventListener("pointerdown", handlePlannerPointerDown, {
      once: false,
    });
  restorePlannerViewport();
}

function refreshMobileSeatingLayout() {
  if (state.activeView !== "seating") return;
  const mobileLayout = window.matchMedia("(max-width: 700px)").matches;
  if (state.renderedMobileSeatingLayout === mobileLayout) return;
  if (!mobileLayout && state.mobileMapOpen) {
    state.mobileMapOpen = false;
    document.body.classList.remove("is-mobile-map-open");
    document.getElementById("mobileMapPortal")?.remove();
  }
  renderActiveView();
}

function renderPlannerStatCard(value, label, tone = "") {
  return `<div class="planner-stat-card${tone ? ` planner-stat-card--${tone}` : ""}"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderMobileSeatingPage({ seatingStats, sideStats, isSaving }) {
  const editing = state.mobileSeatingMode === "edit";
  const seatedPeople = state.tables.reduce((sum, table) => sum + getTableAssignments(table.id).length, 0);
  const peopleNeedingSeats = state.guests.reduce((sum, guest) => sum + getGuestRemainingSeats(guest), 0);
  const controls = `<div class="mobile-seating-map-tools">${actionButton("Zoom out", "planner-zoom-out", state.plannerZoom <= 0.7)}<span class="pill" data-zoom-percentage>${Math.round(state.plannerZoom * 100)}%</span>${actionButton("Zoom in", "planner-zoom-in", state.plannerZoom >= 1.6)}${actionButton("Fit all", "planner-zoom-reset", false, "secondary")}</div>`;
  const canvas = `<div class="planner-canvas-viewport mobile-seating-map ${editing ? "is-editing" : ""}" id="plannerViewport" aria-label="Venue map" tabindex="0"><div class="planner-map-extent"><div class="planner-canvas" id="plannerCanvas" style="width:${state.plannerMapWidth}px;height:720px;--planner-zoom:${state.plannerZoom}"><div class="planner-canvas__floor"></div>${state.hallObjects.map(renderHallObject).join("")}${state.tables.length ? state.tables.map(renderPlannerTable).join("") : `<div class="da3wa-empty">No tables yet. Edit the floor plan to add one.</div>`}</div></div></div>`;
  const tables = state.tables.length ? state.tables.map((table) => {
    const occupied = getTableAssignments(table.id).length;
    const capacity = Number(table.seatCount || table.capacity || table.chairs?.length || 0);
    return `<article class="mobile-seating-table ${table.id === state.selectedTableId ? "is-selected" : ""}"><div><strong>${escapeHtml(table.name || "Table")}</strong><span>${occupied}/${capacity} seats occupied · ${Math.max(0, capacity - occupied)} available</span></div><button class="da3wa-button da3wa-button--secondary" type="button" data-action="mobile-browse-table" data-table-id="${escapeAttribute(table.id)}">${occupied ? "Manage seats" : "Assign guests"}</button></article>`;
  }).join("") : `<div class="mobile-seating-empty"><strong>No tables yet</strong><p>Add tables and venue items to start seating people.</p><button class="da3wa-button da3wa-button--primary" type="button" data-action="mobile-set-seating-mode" data-mode="edit">Edit floor plan</button></div>`;
  elements.pageContent.innerHTML = `<section class="seating-page mobile-seating-page">
    <header class="mobile-seating-header"><div><p class="da3wa-eyebrow">Seating plan</p><h1>Seating</h1></div><span class="mobile-seating-save" aria-live="polite">${isSaving ? "Saving changes…" : "✓ Saved"}</span></header>
    <nav class="mobile-seating-modes" aria-label="Seating mode"><button type="button" data-action="mobile-set-seating-mode" data-mode="assign" aria-pressed="${!editing}" class="${!editing ? "is-active" : ""}">Assign seats</button><button type="button" data-action="mobile-set-seating-mode" data-mode="edit" aria-pressed="${editing}" class="${editing ? "is-active" : ""}">Edit floor plan</button></nav>
    ${editing ? `<div class="mobile-seating-edit-banner"><strong>Editing floor plan</strong><span>Select an object, then drag it to move. Drag the background to pan.</span><button class="da3wa-button da3wa-button--primary" type="button" data-action="mobile-set-seating-mode" data-mode="assign">Done editing</button></div>` : ""}
    <article class="mobile-seating-progress"><div><strong>${seatedPeople}</strong><span>People seated</span></div><div><strong>${peopleNeedingSeats}</strong><span>People needing seats</span></div><button type="button" data-action="mobile-toggle-seating-summary" aria-expanded="${state.showFullSeatingSummary}">${state.showFullSeatingSummary ? "Hide seating summary" : "View seating summary"}</button>${state.showFullSeatingSummary ? `<div class="mobile-seating-full-stats">${renderPlannerStatCard(state.tables.length,"Tables")}${renderPlannerStatCard(seatingStats.totalSeats,"Seat capacity")}${renderPlannerStatCard(seatingStats.total,"Primary guest records")}${renderPlannerStatCard(peopleNeedingSeats,"People needing seats")}${renderPlannerStatCard(seatingStats.unassignedGuests,"Parties needing seats")}${eventUsesGuestSides(state.wedding) ? renderPlannerStatCard(`${sideStats.groom.seated}/${sideStats.groom.confirmed}`,"Groom seated") : ""}${eventUsesGuestSides(state.wedding) ? renderPlannerStatCard(`${sideStats.bride.seated}/${sideStats.bride.confirmed}`,"Bride seated") : ""}</div>` : ""}</article>
    ${editing ? `<section class="mobile-floor-tools">${controls}<div>${actionButton("Add table","open-add-table",!canManageSeatingLayout(),"primary")}${actionButton("Add dance floor","open-add-dance-floor",!canManageSeatingLayout(),"secondary")}${actionButton("Done editing","mobile-set-seating-mode",false,"secondary")}</div></section><article class="planner-canvas-shell mobile-seating-canvas-shell">${canvas}${getSelectedTable() ? `<div class="mobile-selected-object">${renderTableInspector(getSelectedTable())}</div>` : getSelectedHallObject() ? `<div class="mobile-selected-object">${renderHallObjectInspector(getSelectedHallObject())}</div>` : ""}<p class="mobile-edit-instruction">Drag a selected object to move it · drag open floor to pan</p></article>` : `<nav class="mobile-seating-views" aria-label="Seating view"><button type="button" data-action="mobile-seating-view" data-view="tables" aria-pressed="${state.mobileSeatingView === "tables"}" class="${state.mobileSeatingView === "tables" ? "is-active" : ""}">Tables</button><button type="button" data-action="mobile-seating-view" data-view="map" aria-pressed="${state.mobileSeatingView === "map"}" class="${state.mobileSeatingView === "map" ? "is-active" : ""}">Map</button></nav>${state.mobileSeatingView === "tables" ? `<section class="mobile-seating-table-list" aria-label="Tables">${tables}</section>` : `<article class="planner-canvas-shell mobile-seating-canvas-shell"><div class="mobile-map-preview-note">Map preview · tables are locked</div>${canvas}<button class="da3wa-button da3wa-button--primary mobile-explore-map" type="button" data-action="mobile-explore-map">Explore map</button></article>`}`}
    ${state.mobileMapOpen ? `<div class="mobile-map-overlay" role="dialog" aria-modal="true" aria-label="Explore seating map"><header><strong>Explore map</strong><button class="da3wa-button da3wa-button--secondary" type="button" data-action="mobile-close-map">Close map</button></header><p>Drag to explore. Tap a seat to assign.</p>${controls}</div>` : ""}
  </section>`;
  document.getElementById("plannerCanvas")?.addEventListener("pointerdown", handlePlannerPointerDown);
  const mobileViewport = document.getElementById("plannerViewport");
  if (state.mobileMapOpen && mobileViewport) {
    let portal = document.getElementById("mobileMapPortal");
    if (!portal) {
      portal = document.createElement("div");
      portal.id = "mobileMapPortal";
      document.body.append(portal);
    }
    portal.replaceChildren(mobileViewport, document.querySelector(".mobile-map-overlay"));
  } else {
    document.getElementById("mobileMapPortal")?.remove();
  }
  if (mobileViewport && (state.mobileMapOpen || state.mobileSeatingMode === "edit")) {
    mobileViewport.addEventListener("touchstart", handleMobileMapTouchStart, { passive: false });
    mobileViewport.addEventListener("touchmove", handleMobileMapTouchMove, { passive: false });
    mobileViewport.addEventListener("touchend", handleMobileMapTouchEnd, { passive: false });
    mobileViewport.addEventListener("touchcancel", handleMobileMapTouchEnd, { passive: false });
  }
  restorePlannerViewport();
}

function mobileTouchDistance(touches) {
  if (touches.length < 2) return 0;
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

function handleMobileMapTouchStart(event) {
  if (!(state.mobileMapOpen || state.mobileSeatingMode === "edit") || !event.touches.length) return;
  if (state.mobileMapOpen || event.touches.length > 1) event.preventDefault();
  const viewport = document.getElementById("plannerViewport");
  const rect = viewport?.getBoundingClientRect();
  state.mobileTouchGesture = {
    target: event.target.closest?.("[data-action='select-seat'],[data-action='select-table'],[data-action='select-hall-object']"),
    startX: event.touches[0].clientX,
    startY: event.touches[0].clientY,
    lastX: event.touches[0].clientX,
    lastY: event.touches[0].clientY,
    center: { ...(state.plannerViewCenter || { x: state.plannerMapWidth / 2, y: 360 }) },
    zoom: state.plannerZoom,
    distance: mobileTouchDistance(event.touches),
    moved: false,
    rect,
  };
}

function handleMobileMapTouchMove(event) {
  const gesture = state.mobileTouchGesture;
  if (!gesture || !event.touches.length) return;
  const viewport = document.getElementById("plannerViewport");
  const canvas = document.getElementById("plannerCanvas");
  if (!viewport || !canvas) return;
  if (event.touches.length > 1) event.preventDefault();
  if (Math.abs(event.touches[0].clientX - gesture.startX) > 8 || Math.abs(event.touches[0].clientY - gesture.startY) > 8) gesture.moved = true;
  if (event.touches.length > 1) {
    if (state.dragState) {
      const drag = state.dragState;
      if (drag.type === "table") {
        state.tables = state.tables.map((row) => row.id === drag.tableId ? { ...row, x: drag.originalX, y: drag.originalY } : row);
        if (drag.node?.isConnected) { drag.node.style.left = `${drag.originalX}%`; drag.node.style.top = `${drag.originalY}%`; }
      }
      if (drag.type === "hall-object") {
        state.hallObjects = state.hallObjects.map((row) => row.id === drag.objectId ? { ...row, x: drag.originalX, y: drag.originalY } : row);
        if (drag.node?.isConnected) { drag.node.style.left = `${drag.originalX}%`; drag.node.style.top = `${drag.originalY}%`; }
      }
      state.dragState = null;
    }
    const distance = mobileTouchDistance(event.touches);
    if (gesture.distance > 0 && distance > 0) {
      const nextZoom = clamp(gesture.zoom * distance / gesture.distance, 0.7, 1.6);
      const midpointX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - gesture.rect.left;
      const midpointY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - gesture.rect.top;
      const focalX = gesture.center.x + (midpointX - viewport.clientWidth / 2) / gesture.zoom;
      const focalY = gesture.center.y + (midpointY - viewport.clientHeight / 2) / gesture.zoom;
      state.plannerZoom = nextZoom;
      state.plannerViewCenter = { x: focalX - (midpointX - viewport.clientWidth / 2) / nextZoom, y: focalY - (midpointY - viewport.clientHeight / 2) / nextZoom };
      canvas.style.setProperty("--planner-zoom", String(nextZoom));
      restorePlannerViewport();
    }
    return;
  }
  if (!state.mobileMapOpen) return;
  const touch = event.touches[0];
  const dx = touch.clientX - gesture.lastX;
  const dy = touch.clientY - gesture.lastY;
  state.plannerViewCenter = { x: (state.plannerViewCenter || gesture.center).x - dx / state.plannerZoom, y: (state.plannerViewCenter || gesture.center).y - dy / state.plannerZoom };
  gesture.lastX = touch.clientX;
  gesture.lastY = touch.clientY;
  restorePlannerViewport();
}

function handleMobileMapTouchEnd(event) {
  const gesture = state.mobileTouchGesture;
  if (!gesture) return;
  if (event.type === "touchcancel") {
    state.mobileTouchGesture = null;
    return;
  }
  if (event.touches.length) {
    gesture.lastX = event.touches[0].clientX;
    gesture.lastY = event.touches[0].clientY;
    gesture.center = { ...(state.plannerViewCenter || gesture.center) };
    gesture.zoom = state.plannerZoom;
    gesture.distance = 0;
    gesture.target = null;
    return;
  }
  if (!event.touches.length) {
    if (state.mobileMapOpen && !gesture.moved && gesture.target?.isConnected) gesture.target.click();
    state.mobileTouchGesture = null;
  }
}

function restorePlannerViewport() {
  const viewport = document.getElementById("plannerViewport");
  const canvas = document.getElementById("plannerCanvas");
  if (!viewport || !canvas) return;
  const center = state.plannerViewCenter || {
    x: state.plannerMapWidth / 2,
    y: Math.min(360, viewport.clientHeight / (2 * state.plannerZoom)),
  };
  state.plannerViewCenter = center;
  canvas.style.left = `${viewport.clientWidth / 2 - center.x * state.plannerZoom}px`;
  canvas.style.top = `${viewport.clientHeight / 2 - center.y * state.plannerZoom}px`;
}

function renderCheckinPage() {
  const stats = calculateDashboardStats(state.guests, state.tables);
  const recentCheckins = deriveRecentActivity(state.guests)
    .filter((item) => item.type === "checkin")
    .slice(0, 4);
  const checkinLink = new URL(
    `checkin.html?wedding=${encodeURIComponent(state.weddingId)}`,
    window.location.href,
  ).toString();

  elements.pageContent.innerHTML = `
    <section class="checkin-page">
      <div class="checkin-grid">
        <article class="checkin-card">
          <p class="da3wa-eyebrow">Arrival count</p>
          <h3>Checked in guests</h3>
          <div class="metric-pair">
            <strong>${stats.checkedIn}</strong>
            <span>${stats.notCheckedIn} still expected at the venue.</span>
          </div>
          <div class="checkin-card__footer">
            ${actionButton("Open console", "open-checkin", !can("canCheckIn"), "primary")}
            ${actionButton("Copy check-in URL", "copy-checkin")}
          </div>
        </article>

        <article class="checkin-card">
          <p class="da3wa-eyebrow">Secure access</p>
          <h3>Check-in URL</h3>
          <p>Use the existing Firebase-protected hostess flow. This redesign keeps the current access rules intact.</p>
          <code>${escapeHtml(checkinLink)}</code>
        </article>

        <article class="checkin-card">
          <p class="da3wa-eyebrow">Recent check-ins</p>
          <h3>Latest arrivals</h3>
          <div class="activity-list">
            ${
              recentCheckins.length
                ? recentCheckins
                    .map(
                      (item) => `
                      <div class="activity-item">
                        <strong>${escapeHtml(item.title)}</strong>
                        <span>${escapeHtml(item.subtitle)}</span>
                      </div>
                    `,
                    )
                    .join("")
                : `<div class="attention-item"><strong>No arrivals recorded yet</strong><span>Recent guest check-ins will appear here.</span></div>`
            }
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderSharePage() {
  elements.pageContent.innerHTML = `
    <section class="share-page">
      ${isSeatingEnabled() && eventUsesGuestSides(state.wedding) ? renderSeatingAccessCard() : ""}
      ${renderSenderCard()}
    </section>
  `;
}

function eventSettingsDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const pad = (part) => String(part).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function eventSettingsDraftFromWedding(wedding = state.wedding) {
  const parts = eventSettingsDateParts(wedding?.eventDateISO);
  return {
    eventTitle: wedding?.eventTitle || getEventDisplayTitle(wedding),
    brideName: wedding?.brideName || "",
    groomName: wedding?.groomName || "",
    eventDate: parts.date,
    eventTime: parts.time,
    venueEn: wedding?.venueEn || "",
    location: wedding?.location || wedding?.locationEn || "",
    mapsUrl: wedding?.mapsUrl || "",
  };
}

function syncEventSettingsDraftFromForm() {
  const form = document.getElementById("eventSettingsForm");
  if (!form) return;
  state.eventSettingsDraft = Object.fromEntries(
    [...form.querySelectorAll("[data-event-setting-field]")].map((field) => [field.name, field.value]),
  );
}

function updateEventSettingsFormState() {
  const form = document.getElementById("eventSettingsForm");
  const saveButton = form?.querySelector("[data-action='save-event-settings']");
  if (saveButton) {
    saveButton.disabled = !state.dirtyEventSettings || state.savingEventSettings || !canEditEventDetails();
  }
}

function validateEventSettingsDraft(draft) {
  const errors = {};
  if (!String(draft.eventTitle || "").trim()) errors.eventTitle = "Enter an event name.";
  if (!String(draft.venueEn || "").trim()) errors.venueEn = "Enter a venue name.";
  const dateValue = String(draft.eventDate || "");
  const timeValue = String(draft.eventTime || "");
  const parsed = new Date(`${dateValue}T${timeValue}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || Number.isNaN(parsed.getTime())) {
    errors.eventDate = "Enter a valid event date.";
  } else {
    const parts = eventSettingsDateParts(parsed.toISOString());
    if (parts.date !== dateValue) errors.eventDate = "Enter a valid event date.";
  }
  if (!/^\d{2}:\d{2}$/.test(timeValue) || Number.isNaN(parsed.getTime())) {
    errors.eventTime = "Enter a valid event time.";
  }
  const mapsUrl = String(draft.mapsUrl || "").trim();
  if (mapsUrl) {
    try {
      const url = new URL(mapsUrl);
      if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error("Unsupported URL.");
    } catch {
      errors.mapsUrl = "Enter a valid HTTP or HTTPS maps link, or leave it blank.";
    }
  }
  return errors;
}

async function saveEventSettings(event) {
  event.preventDefault();
  if (!canEditEventDetails() || state.savingEventSettings) return;
  syncEventSettingsDraftFromForm();
  const draft = state.eventSettingsDraft || {};
  const errors = validateEventSettingsDraft(draft);
  state.eventSettingsErrors = errors;
  if (Object.keys(errors).length) {
    state.eventSettingsMessage = "Please correct the highlighted fields.";
    renderActiveView();
    document.querySelector(`[name="${Object.keys(errors)[0]}"]`)?.focus();
    return;
  }

  const localDateTime = new Date(`${draft.eventDate}T${draft.eventTime}`);
  const eventDateISO = localDateTime.toISOString();
  const coupleName = [draft.brideName, draft.groomName].map((value) => String(value || "").trim()).filter(Boolean).join(" & ");
  const data = {
    eventTitle: String(draft.eventTitle).trim(),
    eventDateISO,
    timeEn: localDateTime.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }),
    timeAr: `الساعة ${localDateTime.toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" })}`,
    venueEn: String(draft.venueEn).trim(),
    location: String(draft.location || "").trim(),
    locationEn: String(draft.location || "").trim(),
    mapsUrl: String(draft.mapsUrl || "").trim(),
    updatedAt: serverTimestamp(),
  };
  if (eventUsesGuestSides(state.wedding)) {
    data.brideName = String(draft.brideName || "").trim();
    data.groomName = String(draft.groomName || "").trim();
    data.coupleName = coupleName || data.eventTitle;
  }

  state.savingEventSettings = true;
  state.eventSettingsMessage = "Saving event details…";
  renderActiveView();
  try {
    const batch = writeBatch(state.services.db);
    batch.update(doc(state.services.db, "weddings", state.weddingId), data);
    batch.set(
      doc(state.services.db, "users", state.currentUser.uid, "weddingAccess", state.weddingId),
      eventWorkspaceIndexData({ ...state.wedding, ...data }),
      { merge: true },
    );
    await batch.commit();
    state.wedding = { ...state.wedding, ...data };
    state.eventSettingsDraft = null;
    state.eventSettingsOriginal = null;
    state.dirtyEventSettings = false;
    state.eventSettingsErrors = {};
    state.eventSettingsMessage = "Event details saved.";
    showToast("Event details saved.", "success");
  } catch (error) {
    console.error("Could not save event details.", error);
    state.eventSettingsMessage = "We could not save event details. Your changes are still here; check your access and try again.";
    showToast("We could not save event details. Your changes are still here.", "error");
  } finally {
    state.savingEventSettings = false;
    renderAll();
  }
}

function eventWorkspaceIndexData(wedding) {
  return {
    weddingId: state.weddingId,
    ownerUserId: wedding.ownerUserId || state.currentUser?.uid || "",
    eventCategory: wedding.eventCategory || "wedding_engagement",
    eventTitle: wedding.eventTitle || getEventDisplayTitle(wedding),
    coupleName: wedding.coupleName || "",
    brideName: wedding.brideName || "",
    groomName: wedding.groomName || "",
    eventDateISO: wedding.eventDateISO || "",
    venueEn: wedding.venueEn || "",
    location: wedding.location || "",
    status: wedding.status || "active",
    updatedAt: serverTimestamp(),
  };
}

async function queueEventSettingSave(key, value) {
  if (state.mode !== "live" || !canManageInvitationSettings()) {
    renderActiveView();
    showToast("You do not have permission to change this event setting.", "error");
    return;
  }
  const currentValue = key === "showInvitationQr" ? isInvitationQrEnabled() : isSeatingEnabled();
  const mutation = state.eventSettingWrites[key] || {
    version: 0,
    pending: false,
    running: false,
    desired: currentValue,
    persisted: currentValue,
    message: "",
  };
  mutation.version += 1;
  mutation.desired = Boolean(value);
  mutation.pending = true;
  mutation.message = "";
  state.eventSettingWrites[key] = mutation;
  state.wedding = { ...state.wedding, [key]: mutation.desired };
  renderAll();
  if (!mutation.running) void processEventSettingQueue(key, mutation);
}

async function processEventSettingQueue(key, mutation) {
  mutation.running = true;
  const label = key === "showInvitationQr" ? "QR visibility" : "Seating";
  while (mutation.pending) {
    const version = mutation.version;
    const desired = mutation.desired;
    try {
      await updateDoc(doc(state.services.db, "weddings", state.weddingId), {
        [key]: desired,
        updatedAt: serverTimestamp(),
      });
      mutation.persisted = desired;
      if (version !== mutation.version) continue;
      mutation.pending = false;
      mutation.message = "Saved automatically.";
      state.wedding = { ...state.wedding, [key]: desired };
      if (key === "seatingEnabled" && !desired && state.activeView === "seating") {
        state.activeView = "overview";
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("view");
        window.history.replaceState(null, "", nextUrl);
      }
      renderAll();
      showToast(key === "seatingEnabled"
        ? desired ? "Seating is enabled for this event." : "Seating is disabled. Existing layouts and assignments are preserved."
        : desired ? "QR pass will show on invitations." : "QR pass is now hidden on invitations.", "success");
    } catch (error) {
      console.error(`Could not save event setting: ${key}.`, error);
      if (version !== mutation.version) continue;
      mutation.pending = false;
      mutation.desired = mutation.persisted;
      mutation.message = "Save failed. The saved value has been restored.";
      state.wedding = { ...state.wedding, [key]: mutation.persisted };
      renderAll();
      showToast(`We could not save ${label.toLowerCase()}. The saved value has been restored.`, "error");
    }
  }
  mutation.running = false;
}

async function updateEventLifecycle(action) {
  if (!canEditEventDetails() || state.eventStatusPending) return;
  if (state.dirtyEventSettings) {
    showToast("Save or discard your event detail edits before changing the event status.", "info");
    return;
  }
  const wedding = state.wedding;
  if (!wedding || wedding.status === "archived") return;
  const completing = action === "complete-event";
  if (completing === (wedding.status === "completed")) return;
  const title = getEventDisplayTitle(wedding);
  const confirmation = completing
    ? `Mark “${title}” as completed? It will move into Old Events. You can reopen it later.`
    : `Reopen “${title}” and return it to the active event list?`;
  if (!window.confirm(confirmation)) return;

  const previousStatus = ["draft", "upcoming", "active"].includes(wedding.status)
    ? wedding.status
    : "active";
  const lifecycleData = completing
    ? { status: "completed", statusBeforeCompletion: previousStatus, completedAt: serverTimestamp() }
    : { status: ["draft", "upcoming", "active"].includes(wedding.statusBeforeCompletion) ? wedding.statusBeforeCompletion : "active", statusBeforeCompletion: null, completedAt: null };
  state.eventStatusPending = true;
  state.eventLifecycleMessage = "Updating event status…";
  renderActiveView();
  try {
    const nextWedding = { ...wedding, ...lifecycleData };
    const batch = writeBatch(state.services.db);
    batch.update(doc(state.services.db, "weddings", state.weddingId), {
      ...lifecycleData,
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(state.services.db, "users", state.currentUser.uid, "weddingAccess", state.weddingId),
      eventWorkspaceIndexData(nextWedding),
      { merge: true },
    );
    await batch.commit();
    state.wedding = nextWedding;
    state.eventLifecycleMessage = completing ? "Event marked as completed." : "Event reopened.";
    showToast(state.eventLifecycleMessage, "success");
  } catch (error) {
    console.error("Could not update event status.", error);
    state.eventLifecycleMessage = "We could not update the event status. Please try again.";
    showToast(state.eventLifecycleMessage, "error");
  } finally {
    state.eventStatusPending = false;
    renderAll();
  }
}

function renderEventSettingsPage() {
  const wedding = state.wedding || {};
  if (!state.eventSettingsDraft || !state.dirtyEventSettings) {
    state.eventSettingsDraft = eventSettingsDraftFromWedding(wedding);
    state.eventSettingsOriginal = { ...state.eventSettingsDraft };
  }
  const draft = state.eventSettingsDraft;
  const errors = state.eventSettingsErrors || {};
  const canEditDetails = canEditEventDetails();
  const canChangeOptions = state.mode === "live" && canManageInvitationSettings();
  const showQr = state.eventSettingWrites.showInvitationQr?.pending
    ? state.eventSettingWrites.showInvitationQr.desired
    : wedding.showInvitationQr !== false;
  const seatingEnabled = state.eventSettingWrites.seatingEnabled?.pending
    ? state.eventSettingWrites.seatingEnabled.desired
    : wedding.seatingEnabled !== false;
  const isCompleted = wedding.status === "completed";
  const statusAction = isCompleted ? "reopen-event" : "complete-event";
  const statusLabel = isCompleted ? "Reopen event" : "Mark event as completed";
  const title = getEventDisplayTitle(wedding);
  const settingStatus = (key) => {
    const mutation = state.eventSettingWrites[key];
    if (mutation?.pending) return "Saving automatically…";
    if (mutation?.message) return mutation.message;
    return "Changes save automatically for this event.";
  };
  const field = (name, label, type = "text", full = false, required = false, autocomplete = "") => {
    const value = draft[name] || "";
    const message = errors[name] || "";
    return `<label class="event-settings-field${full ? " is-full" : ""}"><span>${label}${required ? " <b aria-hidden=\"true\">*</b>" : ""}</span><input class="da3wa-input" name="${name}" type="${type}" value="${escapeAttribute(value)}" data-event-setting-field ${required ? "required" : ""} ${autocomplete ? `autocomplete="${autocomplete}"` : ""} ${canEditDetails ? "" : "disabled aria-disabled=\"true\""} ${message ? "aria-invalid=\"true\"" : ""} /><small class="event-setting-error" role="alert">${escapeHtml(message)}</small></label>`;
  };

  elements.pageContent.innerHTML = `
    <section class="event-settings-page">
      <form class="event-settings-section share-card" id="eventSettingsForm" novalidate>
        <header class="event-settings-section__header">
          <div><p class="da3wa-eyebrow">Event information</p><h2>Event details</h2><p>These details appear on your event overview and guest invitations.</p></div>
        </header>
        <div class="event-settings-fields">
          ${field("eventTitle", isCelebrationEvent(wedding) ? "Event name" : "Event title", "text", true, true)}
          ${isCelebrationEvent(wedding) ? "" : `${field("brideName", "Bride name", "text", false, false, "given-name")}${field("groomName", "Groom name", "text", false, false, "given-name")}`}
          ${field("eventDate", "Event date", "date", false, true)}
          ${field("eventTime", "Event time", "time", false, true)}
          ${field("venueEn", "Venue name", "text", false, true)}
          ${field("location", "Location / address", "text", false, false, "street-address")}
          ${field("mapsUrl", "Maps link", "url", true, false)}
          <p class="event-settings-timezone">Date and time use the same local time display as the rest of the dashboard.</p>
        </div>
        <div class="event-settings-actions">
          <p class="event-settings-feedback ${state.eventSettingsMessage.startsWith("We could not") ? "is-error" : ""}" role="status">${escapeHtml(state.eventSettingsMessage || (state.dirtyEventSettings ? "Unsaved changes" : ""))}</p>
          <button class="da3wa-button da3wa-button--primary" type="submit" data-action="save-event-settings" ${!state.dirtyEventSettings || state.savingEventSettings || !canEditDetails ? "disabled aria-disabled=\"true\"" : ""}>${state.savingEventSettings ? "Saving…" : "Save changes"}</button>
        </div>
      </form>

      <section class="event-settings-section share-card" aria-labelledby="eventOptionsTitle">
        <header class="event-settings-section__header"><div><p class="da3wa-eyebrow">Guest experience</p><h2 id="eventOptionsTitle">Invitation and seating options</h2><p>These event-specific options save automatically.</p></div></header>
        <label class="invitation-setting-toggle">
          <span><strong>Show QR code on invitation</strong><small>Show the guest’s existing entrance pass on their invitation.</small><small class="event-setting-option-status" role="status">${escapeHtml(settingStatus("showInvitationQr"))}</small></span>
          <input type="checkbox" data-action="toggle-event-qr" ${showQr ? "checked" : ""} ${canChangeOptions ? "" : "disabled aria-disabled=\"true\""} aria-label="Show QR code on invitation" />
        </label>
        <label class="invitation-setting-toggle">
          <span><strong>Enable seating</strong><small>Turn off seating controls while keeping the saved layout and assignments.</small><small class="event-setting-option-status" role="status">${escapeHtml(settingStatus("seatingEnabled"))}</small></span>
          <input type="checkbox" role="switch" data-action="toggle-event-seating" ${seatingEnabled ? "checked" : ""} ${canChangeOptions ? "" : "disabled aria-disabled=\"true\""} aria-label="Enable seating" />
        </label>
      </section>

      <section class="event-settings-section event-settings-status share-card" aria-labelledby="eventStatusTitle">
        <header class="event-settings-section__header"><div><p class="da3wa-eyebrow">Lifecycle</p><h2 id="eventStatusTitle">Event status</h2><p>Current status: <strong class="event-settings-status__value">${escapeHtml(prettifyShape(wedding.status || "active"))}</strong></p></div></header>
        ${wedding.status === "archived" ? `<p class="event-settings-feedback is-error">Archived events cannot be completed or reopened here.</p>` : `<div class="event-settings-actions"><p class="event-settings-feedback ${state.eventLifecycleMessage.startsWith("We could not") ? "is-error" : ""}" role="status" id="eventStatusFeedback">${escapeHtml(state.eventLifecycleMessage)}</p><button class="da3wa-button ${isCompleted ? "da3wa-button--secondary" : "da3wa-button--primary"}" type="button" data-action="${statusAction}" ${!canEditDetails || state.eventStatusPending ? "disabled aria-disabled=\"true\"" : ""}>${state.eventStatusPending ? "Updating status…" : statusLabel}</button></div>`}
      </section>
    </section>
  `;
}

function renderSideViewCard() {
  const sideOption = (label, side, arabicLabel) => {
    const count = state.guests.filter((guest) =>
      sideViewMatches(guest, side),
    ).length;
    return `
      <div class="sender-option">
        <div class="sender-option__copy">
          <strong>${escapeHtml(label)} <span class="side-view-ar" dir="rtl">${escapeHtml(arabicLabel)}</span></strong>
          <span>${count} guest${count === 1 ? "" : "s"} on this page · ${side === "family" ? "read-only status" : "editable seating manager"}</span>
        </div>
        <div class="sender-option__actions">
          ${actionButton("Open", "open-side-view", !count, "secondary", side)}
          ${actionButton("Copy link", "copy-side-view", !count, "primary", side)}
        </div>
      </div>
    `;
  };
  return `
    <article class="share-card share-card--sender">
      <p class="da3wa-eyebrow">Side status pages</p>
      <h3>A simple page for each family — no dashboard needed</h3>
      <p>Groom and Bride links open an authenticated, side-scoped seating manager. Family stays a read-only status page showing only its numbers and seating plan. Side managers never receive the full dashboard.</p>
      <div class="sender-options">
        ${sideOption("Groom side", "groom", "أهل العريس")}
        ${sideOption("Bride side", "bride", "أهل العروس")}
        ${sideOption("Family side", "family", "العائلة")}
      </div>
    </article>
  `;
}

function renderSenderCard() {
  const excluded = state.guests.filter(
    (guest) => !normalizeWhatsAppPhone(guest.phone) || !guest.guestToken,
  ).length;
  const familyCount = getSenderGuests("family").length;
  const senderOption = (label, side, note = "") => {
    const count = getSenderGuests(side).length;
    return `
      <div class="sender-option">
        <div class="sender-option__copy">
          <strong>${escapeHtml(label)}</strong>
          <span>${count} guest${count === 1 ? "" : "s"} ready to invite${note ? ` · ${escapeHtml(note)}` : ""}${count > 150 ? " · long list — the link may be too large for some messaging apps" : ""}</span>
        </div>
        <div class="sender-option__actions">
          ${actionButton("Open", "open-sender", !count, "secondary", side)}
          ${actionButton("Copy link", "copy-sender", !count, "primary", side)}
        </div>
      </div>
    `;
  };
  return `
    <article class="share-card share-card--sender">
      ${eventUsesGuestSides(state.wedding) ? "" : `<h3>Send invitations to all guests</h3><p>One ready-made sender link includes every guest with a phone number and invitation link.</p>`}
      <div class="sender-options">
        ${eventUsesGuestSides(state.wedding) ? `${senderOption("Groom side", "groom")}${senderOption("Bride side", "bride")}${familyCount ? senderOption("Family", "family", "family guests appear only here and in All guests") : ""}${senderOption("All guests", "all")}` : senderOption("All guests", "all")}
      </div>
      ${excluded ? `<p class="da3wa-form-hint">${excluded} guest${excluded === 1 ? " is" : "s are"} excluded for a missing phone number or invitation link.</p>` : ""}
    </article>
  `;
}

function renderExportsPage() {
  const cards = [
    exportCard(
      "All guests",
      "Guest directory with contact, party size, invitation, RSVP, and attendance data.",
      "export-all",
      "third",
    ),
    exportCard(
      "Pending",
      "Guests still awaiting a response.",
      "export-pending",
      "third",
    ),
    exportCard(
      "Confirmed",
      "Guests with accepted RSVP status.",
      "export-confirmed",
      "third",
    ),
    exportCard(
      "Declined",
      "Guests who cannot attend.",
      "export-declined",
      "third",
    ),
    exportCard(
      "Table assignments",
      "Roster sorted by table and seat placement.",
      "export-tables",
      "third",
    ),
  ];

  elements.pageContent.innerHTML = `
    <section class="exports-page">
      <div class="export-grid">
        ${cards.join("")}
      </div>
    </section>
  `;
}

function renderKpiCard(title, value, meta, note) {
  return `
    <article class="kpi-card">
      <p class="da3wa-eyebrow">${escapeHtml(title)}</p>
      <div class="kpi-card__value">${escapeHtml(String(value))}</div>
      <div class="kpi-card__meta">
        <span>${escapeHtml(meta)}</span>
        <strong>${escapeHtml(note)}</strong>
      </div>
    </article>
  `;
}

function renderDistributionRow(label, bucket) {
  const seatingLabel = bucket.confirmed
    ? `${bucket.seated}/${bucket.confirmed} ready`
    : "No confirmed parties";
  return `
    <tr>
      <th scope="row" data-label="Side">${escapeHtml(label)}</th>
      <td data-label="Invited">${escapeHtml(String(bucket.guestCount))}</td>
      <td data-label="Confirmed">${escapeHtml(String(bucket.confirmed))}</td>
      <td data-label="Pending">${escapeHtml(String(bucket.pending))}</td>
      <td data-label="Seating"><span class="overview-seating-status">${escapeHtml(seatingLabel)}</span></td>
    </tr>
  `;
}

function progressRow(label, value, total, tone) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return `
    <div class="progress-row">
      <div class="progress-row__header">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))} · ${percent}%</strong>
      </div>
      <div class="progress-track">
        <div class="progress-bar progress-bar--${tone}" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

function renderGuestRow(guest) {
  const inviteLink = buildInviteLink(guest.guestToken);
  const qrLink = guest.qrCodeValue || buildCheckinLink(guest.guestToken);
  const isSelected = state.selectedGuestIds.includes(guest.id);
  const menuOpen = state.activeGuestMenu?.guestId === guest.id;
  const sideCell = eventUsesGuestSides(state.wedding) ? `<td>${badge(guest.side || "other", "plain")}</td>` : "";

  return `
    <tr class="guest-row ${isSelected ? "is-selected" : ""}">
      <td><input type="checkbox" value="${guest.id}" data-guest-select ${isSelected ? "checked" : ""} aria-label="Select ${escapeAttribute(guest.fullName || "guest")}" /></td>
      <td>
        <div class="guest-primary">
          <button class="guest-name-button" type="button" data-action="edit-guest" data-id="${escapeAttribute(guest.id)}">${escapeHtml(guest.fullName || "Guest")}</button>
        </div>
      </td>
      <td>${escapeHtml(guest.phone || "Not set")}</td>
      <td><span class="guest-count">${escapeHtml(String(normalizeAdditionalGuests(guest.additionalGuests)))}</span></td>
      ${sideCell}
      <td>${renderGuestRsvpSelect(guest)}</td>
      <td>
        <div class="guest-row__actions">
          ${renderGuestInlineActions(guest)}
          ${renderGuestMenuToggle(guest, "table", menuOpen)}
          <span class="is-hidden" data-invite-link="${escapeAttribute(inviteLink)}"></span>
          <span class="is-hidden" data-qr-link="${escapeAttribute(qrLink)}"></span>
        </div>
      </td>
    </tr>
  `;
}

function renderGuestCard(guest) {
  return `
    <article class="guest-card">
      <div class="guest-card__header">
        <div class="guest-primary">
          <button class="guest-name-button" type="button" data-action="edit-guest" data-id="${escapeAttribute(guest.id)}">${escapeHtml(guest.fullName || "Guest")}</button>
        </div>
        ${renderGuestRsvpSelect(guest)}
      </div>
      <div class="guest-card__meta">
        <span>Phone: ${escapeHtml(guest.phone || "Not set")}</span>
        <span>Additional guests: ${escapeHtml(String(normalizeAdditionalGuests(guest.additionalGuests)))}</span>
        ${eventUsesGuestSides(state.wedding) ? `<span>Side: ${escapeHtml(guest.side || "other")}</span>` : ""}
        ${isSeatingEnabled() ? `<span>${renderReservationReadinessBadge(guest)}</span>` : ""}
      </div>
      <div class="guest-card__actions">
        ${renderGuestInlineActions(guest)}
        ${renderGuestMenuToggle(guest, "card", state.activeGuestMenu?.guestId === guest.id)}
      </div>
    </article>
  `;
}

function renderSeatingAccessCard() {
  if (!canManageSeatingAccess()) return "";
  const loginLink = seatingAccountLoginLink();
  return `
    <article class="share-card share-card--sender">
      <h3>Bride &amp; Groom seating sign-in</h3>
      <code>${escapeHtml(loginLink)}</code>
      <div class="sender-option__actions">
        ${actionButton("Copy sign-in link", "copy-seating-login", false, "primary")}
        <a class="da3wa-button da3wa-button--secondary" href="${escapeAttribute(loginLink)}" target="_blank" rel="noopener">Open sign-in</a>
      </div>
    </article>`;
  /* Legacy Cloud Function link controls are retained below temporarily, but
     are unreachable while account-based seating access is in use. */
  const card = (role, label) => {
    const access = state.seatingAccess[role];
    const status =
      access?.status === "active"
        ? "Active"
        : access?.status === "revoked"
          ? "Revoked"
          : "Not Created";
    const created = access?.regeneratedAt || access?.createdAt;
    const when = created ? formatTimestamp(created) : "—";
    const hasLink = Boolean(access?.status === "active");
    return `
      <article class="sender-option seating-access-card">
        <div class="sender-option__copy">
          <strong>${label}</strong>
          <span>${status} · ${access?.status === "active" ? "Created / regenerated" : "Last updated"}: ${escapeHtml(when)}</span>
        </div>
        <div class="sender-option__actions">
          ${!access || access.status === "revoked" ? actionButton("Generate secure editor link", "generate-seating-access", false, "primary", role) : ""}
          ${hasLink ? actionButton("Copy link", "copy-seating-access", false, "secondary", role) : ""}
          ${hasLink ? actionButton("Open link", "open-seating-access", false, "secondary", role) : ""}
          ${access?.status === "active" ? actionButton("Regenerate link", "regenerate-seating-access", false, "secondary", role) : ""}
          ${access?.status === "active" ? actionButton("Revoke access", "revoke-seating-access", false, "danger", role) : ""}
        </div>
      </article>`;
  };
  return `
    <article class="share-card share-card--sender">
      <p class="da3wa-eyebrow">Wedding Seating Access</p>
      <h3>Secure side-specific seating-editor links</h3>
      <p>Only the wedding owner can create, copy, regenerate, or revoke these links. Bride and Groom links can manage every guest's chair in the shared plan; Family links are strictly read-only.</p>
      <div class="sender-options">${card("bride", "Bride")}${card("groom", "Groom")}${card("family", "Family")}</div>
    </article>`;
}

function seatingAccountLoginLink() {
  const params = new URLSearchParams({
    wedding: state.weddingId,
    seatingOnly: "1",
    linkRevision: "all-sides-20261001",
  });
  return new URL(`dashboard-login.html?${params.toString()}`, window.location.href).toString();
}

function seatingEditorLink(token) {
  // Secure side links open the mobile seating workspace. The token is still
  // exchanged for a custom Auth token by the page; token claims, never query
  // parameters, determine the role and permissions.
  return new URL(
    `side.html?token=${encodeURIComponent(token)}`,
    window.location.href,
  ).toString();
}

// The Bride and Groom cards in "Side status pages" intentionally use the
// same signed, revocable manager links as the Seating Access card.  Family
// keeps the ordinary public status URL because it is read-only.
async function openOrCreateSideManagerLink(role, shouldOpen) {
  if (!["bride", "groom"].includes(role)) {
    return;
  }
  const access = state.seatingAccess[role];
  if (access?.status === "active") {
    await manageSeatingAccess(role, shouldOpen ? "open" : "reveal");
    return;
  }
  await manageSeatingAccess(role, "generate");
  if (shouldOpen) {
    await manageSeatingAccess(role, "open");
  }
}

async function manageSeatingAccess(role, action) {
  if (!canManageSeatingAccess() || !["bride", "groom", "family"].includes(role)) {
    showToast(
      "Only the event owner can manage seating editor access.",
      "error",
    );
    return;
  }
  if (
    action === "revoke" &&
    !window.confirm(
      `Revoke the ${role} seating-editor link? It will stop working immediately.`,
    )
  )
    return;
  try {
    const call = httpsCallable(
      state.services.functions,
      "manageSeatingEditorAccess",
    );
    const result = await call({
      weddingId: state.weddingId,
      role,
      action: action === "open" ? "reveal" : action,
    });
    if (result.data?.token) {
      const link = seatingEditorLink(result.data.token);
      if (action === "open") {
        window.open(link, "_blank", "noopener");
        showToast("Secure editor link opened.", "success");
      } else {
        await copyText(link);
        showToast(
          action === "reveal"
            ? "Secure editor link copied."
            : `${role[0].toUpperCase()}${role.slice(1)} editor link created and copied.`,
          "success",
        );
      }
      state.seatingAccess[role] = {
        ...(state.seatingAccess[role] || {}),
        role,
        status: "active",
        regeneratedAt: new Date(),
      };
    } else {
      state.seatingAccess[role] = {
        ...(state.seatingAccess[role] || {}),
        status: "revoked",
        link: "",
      };
      showToast(
        `${role[0].toUpperCase()}${role.slice(1)} editor access revoked.`,
        "success",
      );
    }
    renderActiveView();
  } catch (error) {
    console.error(error);
    showToast(
      "We could not update seating editor access. Please try again.",
      "error",
    );
  }
}

function renderGuestInlineActions(guest) {
  const editDisabled = !can("canEditGuests");
  return `
    <div class="guest-inline-actions" aria-label="Quick actions for ${escapeAttribute(guest.fullName || "guest")}">
      <button class="guest-quick-button guest-quick-button--copy" type="button" data-action="copy-guest-invite" data-guest-id="${escapeAttribute(guest.id)}" aria-label="Copy invitation link for ${escapeAttribute(guest.fullName || "guest")}" title="Copy invitation link">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>
      </button>
      <button class="guest-quick-button" type="button" data-action="edit-guest" data-id="${escapeAttribute(guest.id)}" ${editDisabled ? 'disabled aria-disabled="true"' : ""}>Edit guest</button>
    </div>
  `;
}

function renderGuestMenuToggle(guest, surface, expanded = false) {
  return `
    <button class="guest-row__menu-toggle" id="guest-menu-trigger-${escapeAttribute(guest.id)}-${surface}" type="button" data-action="toggle-guest-menu" data-guest-id="${escapeAttribute(guest.id)}" aria-label="Open guest actions for ${escapeAttribute(guest.fullName || "guest")}" aria-haspopup="menu" aria-expanded="${expanded ? "true" : "false"}" aria-controls="guestActionMenu">⋯</button>
  `;
}

function renderGuestRsvpSelect(guest) {
  const status = guest.rsvpStatus || "pending";
  const disabled = !can("canEditGuests");
  return `
    <select class="guest-rsvp-select guest-rsvp-select--${escapeAttribute(status)}" data-guest-rsvp-status data-guest-id="${escapeAttribute(guest.id)}" ${disabled ? 'disabled aria-disabled="true"' : ""} aria-label="Change RSVP status for ${escapeAttribute(guest.fullName || "guest")}">
      <option value="confirmed" ${status === "confirmed" ? "selected" : ""}>Confirmed</option>
      <option value="pending" ${status === "pending" ? "selected" : ""}>Pending</option>
      <option value="declined" ${status === "declined" ? "selected" : ""}>Declined</option>
    </select>
  `;
}

function renderPlannerTable(table) {
  const isSelected = table.id === state.selectedTableId;
  const occupied = getTableAssignments(table.id).length;
  const width = Number(table.width || defaultWidthForShape(table.shape));
  const height = Number(table.height || defaultHeightForShape(table.shape));
  const transform = `translate(-50%, -50%) rotate(${Number(table.rotation || 0)}deg)`;
  const shapeClass = `planner-table__surface--${escapeAttribute(table.shape || "round")}`;
  return `
    <div
      class="planner-table ${isSelected ? "is-selected" : ""}"
      style="left:${Number(table.x || 0)}%; top:${Number(table.y || 0)}%; width:${width}px; height:${height}px; transform:${transform};"
      data-table-drag-id="${table.id}"
      data-table-id="${table.id}"
      data-action="select-table"
    >
      <div class="planner-table__inner">
        ${table.chairs.map((chair) => renderPlannerChair(table, chair)).join("")}
        <button
          class="planner-table__surface ${shapeClass}"
          type="button"
          style="--table-fill:${escapeAttribute(table.tableColor || plannerPalette.tableColor)}; --table-border:${escapeAttribute(table.borderColor || plannerPalette.borderColor)};"
          data-action="select-table"
          data-table-id="${table.id}"
        >
          <div class="planner-table__label">
            <strong>${escapeHtml(table.name)}</strong>
            <span>${occupied}/${Number(table.seatCount || 0)} seated</span>
          </div>
        </button>
      </div>
    </div>
  `;
}

function renderPlannerChair(table, chair) {
  const assignment = getChairAssignment(table.id, chair);
  const guest = assignment?.guestId
    ? state.guests.find((item) => item.id === assignment.guestId)
    : null;
  const statusClass = chairStatusClass(chair, guest, assignment);
  const isSelected = state.selectedSeatId === buildSeatKey(table.id, chair.id);
  const isTemporary = isChairTemporarilySelected(table.id, chair.id);
  const isPartyHighlighted =
    assignment?.guestId && assignment.guestId === state.activePartyGuestId;
  const label = assignment
    ? assignment.partyMemberIndex === 0
      ? getInitials(guest?.fullName) || "M"
      : `+${assignment.partyMemberIndex}`
    : String(chair.seatNumber);
  return `
    <button
      class="planner-chair planner-chair--${escapeAttribute(statusClass)} ${isSelected ? "is-selected" : ""} ${isTemporary ? "is-temporary" : ""} ${isPartyHighlighted ? "is-party-highlighted" : ""}"
      type="button"
      style="left:${chair.x}%; top:${chair.y}%; --chair-color:${escapeAttribute(resolveChairColor(statusClass, table))};"
      title="${escapeAttribute(assignment ? `${partyMemberLabel(guest, assignment.partyMemberIndex)} - ${table.name} chair ${chair.seatNumber}` : `Available chair ${chair.seatNumber}`)}"
      data-action="select-seat"
      data-table-id="${table.id}"
      data-chair-id="${chair.id}"
    >
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}
function renderHallObject(item) {
  if (item.type === "dance-floor") {
    const isSelected = item.id === state.selectedHallObjectId;
    return `
      <button
        class="hall-object hall-object--dance-floor ${item.shape === "round" ? "is-round" : "is-rectangle"} ${isSelected ? "is-selected" : ""}"
        type="button"
        style="left:${item.x}%; top:${item.y}%; width:${item.width}px; height:${item.height}px; --dance-fill:${escapeAttribute(item.fillColor)}; --dance-border:${escapeAttribute(item.borderColor)}; --dance-rotation:${Number(item.rotation || 0)}deg;"
        aria-label="${escapeAttribute(`${item.label}, dance floor${item.locked ? ", locked" : ""}`)}"
        title="${escapeAttribute(item.label)}"
        data-hall-object-id="${escapeAttribute(item.id)}"
        data-action="select-hall-object"
      ><span>${escapeHtml(item.label)}</span></button>
    `;
  }
  const icon = item.type === "stage" ? renderStageIcon() : renderEntranceIcon();
  return `
    <button
      class="hall-object hall-object--${escapeAttribute(item.type)} ${item.id === state.selectedHallObjectId ? "is-selected" : ""} ${item.locked ? "is-locked" : ""}"
      type="button"
      style="left:${item.x}%; top:${item.y}%;"
      title="${escapeAttribute(item.label)}"
      aria-label="${escapeAttribute(item.label)}"
      data-hall-object-id="${escapeAttribute(item.id)}"
      data-action="select-hall-object"
    >
      ${icon}
      <span>${escapeHtml(item.label)}</span>
    </button>
  `;
}

function canManageInvitationSettings() {
  return isWeddingOwner() || can("canManageUsers");
}

function isSeatingEnabled() {
  // Missing field means enabled so existing events keep their current behavior.
  return state.wedding?.seatingEnabled !== false;
}

function isInvitationQrEnabled() {
  // Missing field means enabled so existing events keep their current behavior.
  return state.wedding?.showInvitationQr !== false;
}

function renderHallObjectInspector(item) {
  const isDanceFloor = item.type === "dance-floor";
  const compactEdit = window.matchMedia("(max-width: 700px)").matches && state.mobileSeatingMode === "edit";
  return `
    <div class="planner-table-summary">
      <div><span>${isDanceFloor ? "Dance floor" : "Venue object"}</span><strong>${escapeHtml(item.label)}</strong></div>
      <div><span>Zone</span><strong>${escapeHtml(item.floorZone || "Not set")}</strong></div>
    </div>
    <p class="planner-note">${isDanceFloor ? `${escapeHtml(prettifyShape(item.shape))} · ${item.width} × ${item.height}px · ${item.rotation || 0}°` : "Default venue marker"}${item.locked ? " · Locked" : ""}</p>
    ${item.notes ? `<p class="planner-note">${escapeHtml(item.notes)}</p>` : ""}
    <div class="guest-toolbar__summary">
      ${isDanceFloor ? actionButton("Edit", "edit-dance-floor", !canManageSeatingLayout(), "secondary", item.id) : ""}
      ${compactEdit ? `<details class="mobile-object-actions"><summary>More actions</summary>${isDanceFloor ? actionButton("Duplicate", "duplicate-dance-floor", !canManageSeatingLayout(), "secondary", item.id) : ""}${isDanceFloor ? actionButton("Delete", "delete-dance-floor", !canManageSeatingLayout(), "danger", item.id) : ""}</details>` : isDanceFloor ? actionButton("Duplicate", "duplicate-dance-floor", !canManageSeatingLayout(), "secondary", item.id) : ""}
      ${actionButton(item.locked ? "Unlock position" : "Lock position", "toggle-hall-object-lock", !canManageSeatingLayout(), "secondary", item.id)}
      ${compactEdit ? "" : isDanceFloor ? actionButton("Delete", "delete-dance-floor", !canManageSeatingLayout(), "danger", item.id) : ""}
    </div>
  `;
}

function renderStageIcon() {
  return `
    <svg class="hall-object__icon hall-object__icon--stage" viewBox="0 0 48 40" focusable="false" aria-hidden="true">
      <path class="hall-icon-stage__curtain" d="M5 5h38v20l-7-4-6 4-6-4-6 4-6-4-7 4V5Z" />
      <path class="hall-icon-stage__canopy" d="M8 8h32v13l-5-3-6 4-5-4-6 4-6-4-4 3V8Z" />
      <path class="hall-icon-stage__platform" d="M7 27h34l-3 7H10l-3-7Z" />
      <path class="hall-icon-stage__front" d="M12 30h24" />
      <circle class="hall-icon-stage__light" cx="17" cy="13" r="1.3" />
      <circle class="hall-icon-stage__light" cx="24" cy="13" r="1.3" />
      <circle class="hall-icon-stage__light" cx="31" cy="13" r="1.3" />
    </svg>
  `;
}

function renderEntranceIcon() {
  return `
    <svg class="hall-object__icon hall-object__icon--entrance" viewBox="0 0 40 44" focusable="false" aria-hidden="true">
      <path class="hall-icon-entrance__frame" d="M6 38V8a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v30" />
      <path class="hall-icon-entrance__door" d="M13 37V13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v24" />
      <path class="hall-icon-entrance__opening" d="M18 16h6v18h-6z" />
      <path class="hall-icon-entrance__arrow" d="M2 25h14m-5-5 5 5-5 5" />
      <path class="hall-icon-entrance__threshold" d="M5 39h30" />
    </svg>
  `;
}

function renderTableInspector(table) {
  const assignments = getTableAssignments(table.id);
  const capacity = Number(table.seatCount || table.capacity || 0);
  const compactEdit = window.matchMedia("(max-width: 700px)").matches && state.mobileSeatingMode === "edit";
  return `
    <div class="planner-table-summary">
      <div>
        <span>Table</span>
        <strong>${escapeHtml(table.name || "Table")}</strong>
      </div>
      <div>
        <span>Occupied</span>
        <strong>${assignments.length}/${capacity}</strong>
      </div>
    </div>
    <div class="guest-toolbar__summary">
      ${actionButton("Edit", "edit-table", !canManageSeatingLayout(), "secondary", table.id)}
      ${compactEdit ? `<details class="mobile-object-actions"><summary>More actions</summary>${actionButton("Duplicate", "duplicate-table", !canManageSeatingLayout(), "secondary", table.id)}${actionButton("Delete", "delete-table", !canManageSeatingLayout(), "danger", table.id)}</details>` : `${actionButton("Duplicate", "duplicate-table", !canManageSeatingLayout(), "secondary", table.id)}${actionButton("Delete", "delete-table", !canManageSeatingLayout(), "danger", table.id)}`}
    </div>
  `;
}

function renderSeatingGuestsTab(table) {
  if (!table) {
    return '<div class="seating-panel-empty"><strong>Select a table first</strong><span>Guest assignments are shown for the active table.</span></div>';
  }

  const query = state.seatingGuestSearch.trim().toLowerCase();
  const venueRows = state.guests
    .map((guest) => {
      const assignments = getGuestAssignedSeats(getGuestDocumentId(guest));
      const tableAssignments = assignments.filter(
        (assignment) => String(assignment.tableId) === String(table.id),
      );
      return {
        guest,
        assignments,
        tableAssignments,
        seating: summarizePartySeating(guest, assignments),
      };
    });
  const counts = venueRows.reduce((total, { seating }) => ({
    all: total.all + seating.requiredCount,
    assigned: total.assigned + seating.assignedCount,
    unassigned: total.unassigned + seating.remainingCount,
  }), { all: 0, assigned: 0, unassigned: 0 });
  const allRows = venueRows.filter(({ guest }) => {
      if (
        query &&
        ![guest.fullName, guest.phone, guest.side, guest.rsvpStatus].some(
          (value) => String(value || "").toLowerCase().includes(query),
        )
      ) {
        return false;
      }
      return true;
    }).sort((left, right) => {
      const assignmentOrder =
        Number(right.assignments.length > 0) -
        Number(left.assignments.length > 0);
      return assignmentOrder ||
        String(left.guest.fullName || "").localeCompare(
          String(right.guest.fullName || ""),
          undefined,
          { sensitivity: "base" },
        );
    });
  const needsSeats = ({ seating }) => seating.remainingCount > 0;
  const rows = allRows.filter(({ assignments, seating }) => {
    if (state.seatingGuestFilter === "assigned") return seating.assignedCount > 0;
    if (state.seatingGuestFilter === "unassigned") return needsSeats({ seating });
    return true;
  });

  return `
    <div class="seating-guest-tools">
      <label class="seating-guest-search">
        <span class="sr-only">Search seating guests</span>
        <input class="da3wa-input" type="search" placeholder="Search guests" value="${escapeAttribute(state.seatingGuestSearch)}" data-seating-guest-search />
      </label>
      <div class="seating-guest-filters" role="group" aria-label="Filter seating guests by people">
        ${["all", "assigned", "unassigned"].map((filter) => `<button type="button" class="${state.seatingGuestFilter === filter ? "is-active" : ""}" data-action="set-seating-guest-filter" data-filter="${filter}" aria-pressed="${state.seatingGuestFilter === filter}" aria-label="${filter === "unassigned" ? "Needs seats" : filter === "all" ? "All people" : "Assigned people"}: ${counts[filter]} people">${filter === "unassigned" ? "Needs seats" : filter === "all" ? "All people" : "Assigned"} <span>${counts[filter]}</span></button>`).join("")}
      </div>
    </div>
    <div class="seating-guest-rows">
      ${rows.length ? rows.map(({ guest, assignments, tableAssignments, seating }) => renderSeatingGuestRow(guest, assignments, tableAssignments, table, seating)).join("") : `<div class="seating-panel-empty"><strong>${query ? "No guests match your search" : "No guests match this filter"}</strong><span>${query ? "Try a different name or clear your search." : "Choose another filter to see guests."}</span></div>`}
    </div>
  `;
}

function renderSeatingGuestRow(guest, assignments, tableAssignments, table, seating = summarizePartySeating(guest, assignments)) {
  const remaining = seating.remainingCount;
  const locations = assignments.length
    ? assignments.map((assignment) =>
        `${state.tables.find((item) => String(item.id) === String(assignment.tableId))?.name || assignment.tableName || "Table"} · seat ${assignment.seatNumber}`,
      ).join(", ")
    : "No seats assigned";
  return `
    <div class="seating-guest-row ${guest.id === state.activePartyGuestId ? "is-active" : ""}">
      ${assignments.length
        ? `<button class="seating-guest-row__locate" type="button" data-action="locate-seating-guest" data-guest-id="${escapeAttribute(guest.id)}" aria-label="Highlight ${escapeAttribute(guest.fullName || "guest")} and assigned seats"><strong>${escapeHtml(guest.fullName || "Guest")}</strong><small>${escapeHtml(locations)}${remaining ? ` · ${remaining} seat${remaining === 1 ? "" : "s"} still needed` : " · Fully seated"}</small></button>`
        : `<div><strong>${escapeHtml(guest.fullName || "Guest")}</strong><small>No seats assigned · ${remaining} seat${remaining === 1 ? "" : "s"} still needed</small></div>`}
      <div class="seating-guest-row__actions">
        <button class="guest-quick-button" type="button" data-action="open-seating-for-guest" data-guest-id="${escapeAttribute(guest.id)}" ${!can("canEditSeating") ? 'disabled aria-disabled="true"' : ""}>${assignments.length ? "Manage" : "Assign"}</button>
      </div>
    </div>
  `;
}

function locateSeatingGuest(guestId) {
  const guest = state.guests.find((item) => item.id === guestId);
  if (!guest) return;

  const pageScroll = { x: window.scrollX, y: window.scrollY };
  const viewport = document.getElementById("plannerViewport");
  const plannerScroll = {
    left: viewport?.scrollLeft || 0,
    top: viewport?.scrollTop || 0,
  };
  const plannerViewCenter = state.plannerViewCenter
    ? { ...state.plannerViewCenter }
    : null;
  const plannerZoom = state.plannerZoom;

  state.activePartyGuestId = guest.id;
  state.selectedSeatId = "";
  renderActiveView();

  // Rebuilding the seating markup replaces the focused guest button. Restore
  // the existing camera and scroll positions before restoring focus without
  // asking the browser to bring the guest's table into view.
  state.plannerZoom = plannerZoom;
  if (plannerViewCenter) state.plannerViewCenter = plannerViewCenter;
  const nextViewport = document.getElementById("plannerViewport");
  if (nextViewport) {
    nextViewport.scrollLeft = plannerScroll.left;
    nextViewport.scrollTop = plannerScroll.top;
    restorePlannerViewport();
  }
  requestAnimationFrame(() => {
    [...document.querySelectorAll('[data-action="locate-seating-guest"]')]
      .find((button) => button.dataset.guestId === guest.id)
      ?.focus({ preventScroll: true });
    if (window.scrollX !== pageScroll.x || window.scrollY !== pageScroll.y) {
      window.scrollTo(pageScroll.x, pageScroll.y);
    }
  });
}

function openSeatingGuestFlow(guestId) {
  if (!isSeatingEnabled()) {
    showToast("Seating is disabled for this event.", "info");
    return;
  }
  const guest = state.guests.find((item) => item.id === guestId);
  if (!guest || !can("canEditSeating")) {
    return;
  }
  const assignments = getGuestAssignedSeats(guest.id);
  state.activeView = "seating";
  state.seatingPanelTab = "guests";
  state.activePartyGuestId = guest.id;
  state.selectedHallObjectId = "";
  state.selectedSeatId = "";
  state.selectedTableId =
    assignments[0]?.tableId || state.selectedTableId || state.tables[0]?.id || "";

  if (assignments.length) {
    state.assignmentSession = null;
    renderAll();
    openCenteredModal(elements.chairDetailsModal, () =>
      renderChairDetailsModal(guest.id),
    );
    return;
  }

  state.modalError = "";
  state.assignmentSession = {
    mode: "assign",
    guestId: guest.id,
    requiredSeats: getPartySize(guest),
    startingTableId: state.selectedTableId,
    selectedChairs: [],
    existingAssignments: [],
  };
  renderAll();
}

function renderLayoutLibrary() {
  const tables = state.tables
    .map((table) => {
      const occupied = getTableAssignments(table.id).length;
      return `
        <button class="planner-table-list__button ${table.id === state.selectedTableId ? "is-selected" : ""}" type="button" data-action="select-table" data-table-id="${escapeAttribute(table.id)}" aria-pressed="${table.id === state.selectedTableId}" aria-label="${escapeAttribute(`${table.name}, ${prettifyShape(table.shape)} table, ${occupied} of ${Number(table.seatCount || 0)} seated`)}">
          <strong>${escapeHtml(table.name)}</strong>
          <small>${escapeHtml(prettifyShape(table.shape))} · ${occupied}/${Number(table.seatCount || 0)} seated</small>
        </button>
      `;
    })
    .join("");

  const objects = state.hallObjects
    .map(
      (item) => `
        <button class="planner-table-list__button ${item.id === state.selectedHallObjectId ? "is-selected" : ""}" type="button" data-action="select-hall-object" data-hall-object-id="${escapeAttribute(item.id)}" aria-pressed="${item.id === state.selectedHallObjectId}" aria-label="${escapeAttribute(`${item.label}, ${item.type === "dance-floor" ? `${prettifyShape(item.shape)} dance floor` : `${prettifyShape(item.type)} marker`}`)}">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.type === "dance-floor" ? `${prettifyShape(item.shape)} dance floor` : `${prettifyShape(item.type)} marker`)}</small>
        </button>
      `,
    )
    .join("");

  return `
    <div class="planner-table-list">${tables || '<div class="da3wa-empty">No tables yet.</div>'}${objects}</div>
  `;
}

function renderAssignmentLibrary(unassignedGuests) {
  return `
    <div class="planner-filter-group">
      <label>
        <span>RSVP filter</span>
        <select class="da3wa-input" data-library-filter="rsvp">
          <option value="all" ${state.libraryFilters.rsvp === "all" ? "selected" : ""}>All RSVP</option>
          <option value="confirmed" ${state.libraryFilters.rsvp === "confirmed" ? "selected" : ""}>Confirmed first</option>
          <option value="pending" ${state.libraryFilters.rsvp === "pending" ? "selected" : ""}>Pending only</option>
        </select>
      </label>
      ${eventUsesGuestSides(state.wedding) ? `<label>
        <span>Side filter</span>
        <select class="da3wa-input" data-library-filter="side">
          <option value="all" ${state.libraryFilters.side === "all" ? "selected" : ""}>All sides</option>
          <option value="bride" ${state.libraryFilters.side === "bride" ? "selected" : ""}>Bride</option>
          <option value="groom" ${state.libraryFilters.side === "groom" ? "selected" : ""}>Groom</option>
          <option value="family" ${state.libraryFilters.side === "family" ? "selected" : ""}>Family</option>
        </select>
      </label>` : ""}
      <label>
        <span><input type="checkbox" data-library-filter="vipOnly" ${state.libraryFilters.vipOnly ? "checked" : ""} /> VIP notes only</span>
      </label>
    </div>
    <div class="planner-guest-list">
      ${
        unassignedGuests.length
          ? unassignedGuests
              .map(
                (guest) => `
                  <div class="planner-guest-pill">
                    <strong>${escapeHtml(guest.fullName)}</strong>
                    <small>${eventUsesGuestSides(state.wedding) ? `${escapeHtml(guest.side || "other")} · ` : ""}${escapeHtml(guest.rsvpStatus || "pending")} · ${escapeHtml(guest.notes || "No notes")}</small>
                  </div>
                `,
              )
              .join("")
          : '<div class="da3wa-empty">No matching unassigned guests.</div>'
      }
    </div>
  `;
}

function renderAssignmentStatusPanel(selectedSeat) {
  if (!selectedSeat) {
    return "";
  }

  return `<div class="da3wa-empty">Selected ${escapeHtml(selectedSeat.table.name)} chair ${escapeHtml(String(selectedSeat.chair.seatNumber))}. Choose a guest or inspect the assigned party to continue.</div>`;
}

function renderAssignmentControls() {
  const session = state.assignmentSession;
  const guest = state.guests.find((item) => item.id === session.guestId);
  const selectedCount = session.selectedChairs.length;
  const required = session.requiredSeats;
  const canComplete = selectedCount > 0 && !state.activeModalOperation;
  const difference = required - selectedCount;
  const selectionMessage =
    difference > 0
      ? `${difference} more chair${difference === 1 ? "" : "s"} needed for the full party. You can save a partial assignment.`
      : difference < 0
        ? `${Math.abs(difference)} too many chairs selected.`
        : "Required chair count selected.";
  return `
    <div class="assignment-bar" role="region" aria-label="Active seat assignment">
      <div class="assignment-bar__identity">
        <span>Assigning</span>
        <strong>${escapeHtml(guest?.fullName || "Guest party")}</strong>
      </div>
      <div class="assignment-bar__counts" aria-label="Assignment progress">
        <span><strong>${required}</strong> required</span>
        <span><strong>${selectedCount}</strong> selected</span>
      </div>
      <p class="assignment-bar__message ${difference === 0 ? "is-complete" : ""}" role="status">${escapeHtml(state.modalError || selectionMessage)}</p>
      <details class="assignment-bar__details">
        <summary>Selected chairs</summary>
        <span>${escapeHtml(getSelectedChairSummary(session.selectedChairs) || "No chairs selected yet")}</span>
      </details>
      <div class="assignment-bar__actions">
        <button class="da3wa-button da3wa-button--secondary" type="button" data-action="cancel-assignment">Cancel</button>
        <button class="da3wa-button da3wa-button--primary ${!canComplete ? "is-disabled" : ""}" type="button" data-action="complete-assignment" ${!canComplete ? 'disabled aria-disabled="true"' : ""}>Complete assignment</button>
      </div>
    </div>
  `;
}

function renderSeatAssignment(selectedSeat) {
  const availableGuests = getSeatCandidates(selectedSeat.guest?.id);
  const warnings = [];
  if (selectedSeat.guest?.rsvpStatus === "declined") {
    warnings.push(
      "Declined guests can be seated, but the planner should confirm this conflict.",
    );
  }
  if (selectedSeat.guest?.rsvpStatus === "pending") {
    warnings.push(
      "Pending RSVP guest seated. Consider following up before finalizing the chart.",
    );
  }
  return `
    <div class="seat-assignment__header">
      <div>
        <p class="da3wa-eyebrow">Seat assignment</p>
        <h3 class="planner-panel__title">${escapeHtml(selectedSeat.table.name)} · Seat ${escapeHtml(String(selectedSeat.chair.seatNumber))}</h3>
      </div>
      ${badge(selectedSeat.guest ? "Assigned" : "Open seat", selectedSeat.guest ? "confirmed" : "pending")}
    </div>

    <div class="seat-assignment__current">
      <div class="seat-assignment__row">
        <span>Current guest</span>
        <strong>${escapeHtml(selectedSeat.guest?.fullName || "Unassigned")}</strong>
      </div>
      <div class="seat-assignment__row">
        <span>Seat details</span>
        <strong>${escapeHtml(selectedSeat.table.name)} · Chair ${escapeHtml(String(selectedSeat.chair.seatNumber))}</strong>
      </div>
    </div>

    <div class="seat-assignment__controls">
      <input class="da3wa-input" type="search" placeholder="Search guest, side, RSVP, or phone" value="${escapeAttribute(state.guestAssignmentSearch)}" data-seat-search />
      ${
        selectedSeat.guest
          ? actionButton(
              "Clear seat",
              "clear-seat",
              !can("canEditSeating"),
              "ghost",
              `${selectedSeat.table.id}::${selectedSeat.chair.id}`,
            )
          : ""
      }
    </div>

    ${
      warnings.length
        ? `<div class="planner-warning-list">${warnings.map((warning) => `<span class="warning-chip">${escapeHtml(warning)}</span>`).join("")}</div>`
        : ""
    }

    <div class="seat-assignment__list">
      ${
        availableGuests.length
          ? availableGuests
              .map((guest) => {
                const existingSeat = findGuestSeat(guest.id);
                const isCurrent = guest.id === selectedSeat.guest?.id;
                return `
                  <button
                    class="seat-assignment__guest ${isCurrent ? "is-selected" : ""}"
                    type="button"
                    data-action="assign-seat"
                    data-table-id="${selectedSeat.table.id}"
                    data-chair-id="${selectedSeat.chair.id}"
                    data-guest-id="${guest.id}"
                    ${state.activeModalOperation ? 'disabled aria-disabled="true"' : ""}
                  >
                    <strong>${escapeHtml(guest.fullName)}</strong>
                    <small>${eventUsesGuestSides(state.wedding) ? `${escapeHtml(guest.side || "other")} · ` : ""}${escapeHtml(guest.rsvpStatus || "pending")} · ${existingSeat ? "Move from another seat" : "Assign here"}</small>
                  </button>
                `;
              })
              .join("")
          : '<div class="da3wa-empty">No guests match the current assignment filters.</div>'
      }
    </div>
  `;
}

function plannerStat(label, value) {
  return `
    <div class="planner-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function exportCard(title, description, action, layout) {
  return `
    <article class="export-card export-card--${escapeHtml(layout)}">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      <div class="export-card__footer">
        ${actionButton("Download", action, !can("canExport"), "primary")}
      </div>
    </article>
  `;
}

function actionButton(
  label,
  action,
  disabled = false,
  tone = "secondary",
  id = "",
) {
  return `
    <button class="da3wa-button da3wa-button--${tone} ${disabled ? "is-disabled" : ""}" type="button" data-action="${escapeAttribute(action)}" ${id ? `data-id="${escapeAttribute(id)}"` : ""} ${disabled ? 'disabled aria-disabled="true"' : ""}>
      ${escapeHtml(label)}
    </button>
  `;
}

function menuItem(label, action, guestId, disabled = false) {
  return `
    <button class="guest-menu__item ${disabled ? "is-disabled" : ""}" type="button" role="menuitem" data-action="${escapeAttribute(action)}" data-guest-id="${escapeAttribute(guestId)}" ${disabled ? 'disabled aria-disabled="true"' : ""}>
      ${escapeHtml(label)}
    </button>
  `;
}

function renderGuestActionMenu(guest, trigger) {
  const menu = document.createElement("div");
  menu.className = "guest-menu";
  menu.id = "guestActionMenu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions for ${guest.fullName || "guest"}`);
  menu.innerHTML = `
    ${menuItem("WhatsApp", "open-reminder", guest.id, !buildWhatsAppReminderLink(guest))}
    ${menuItem("Copy QR link", "copy-guest-qr", guest.id)}
    ${menuItem("Delete guest", "delete-guest", guest.id, !can("canEditGuests"))}
  `;
  document.body.appendChild(menu);
  positionGuestMenu(menu, trigger);
  state.activeGuestMenu = { guestId: guest.id, element: menu };
  state.lastGuestMenuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  menu.querySelector(".guest-menu__item:not(.is-disabled)")?.focus();
}

function positionGuestMenu(menu, trigger) {
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const gutter = 10;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const openUp =
    triggerRect.bottom + gutter + menuRect.height > viewportHeight &&
    triggerRect.top > menuRect.height + gutter;
  const top = openUp
    ? triggerRect.top - menuRect.height - gutter
    : triggerRect.bottom + gutter;
  const left = Math.min(
    Math.max(gutter, triggerRect.right - menuRect.width),
    viewportWidth - menuRect.width - gutter,
  );

  menu.style.top = `${Math.max(gutter, top)}px`;
  menu.style.left = `${left}px`;
}

function closeGuestMenu(options = {}) {
  const { restoreFocus = true } = options;
  state.activeGuestMenu?.element?.remove();
  document
    .querySelectorAll(".guest-row__menu-toggle[aria-expanded='true']")
    .forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  if (restoreFocus && state.lastGuestMenuTrigger?.isConnected) {
    state.lastGuestMenuTrigger.focus();
  }
  state.activeGuestMenu = null;
  state.lastGuestMenuTrigger = null;
}

function handleGuestMenuKeyboard(event) {
  const items = [
    ...(state.activeGuestMenu?.element?.querySelectorAll(
      ".guest-menu__item:not(.is-disabled)",
    ) || []),
  ];
  if (!items.length) {
    return;
  }
  event.preventDefault();
  const currentIndex = Math.max(0, items.indexOf(document.activeElement));
  const nextIndex = (() => {
    switch (event.key) {
      case "ArrowUp":
        return currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      case "Home":
        return 0;
      case "End":
        return items.length - 1;
      case "ArrowDown":
      default:
        return currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
    }
  })();
  items[nextIndex]?.focus();
}

function selectInput(key, value, options) {
  const label = key === "rsvp" ? "Filter guests by RSVP status" : "Filter guests by invitation side";
  return `
    <select class="da3wa-input" data-guest-filter="${escapeAttribute(key)}" aria-label="${label}">
      ${options
        .map(
          ([optionValue, label]) => `
            <option value="${escapeAttribute(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(label)}</option>
          `,
        )
        .join("")}
    </select>
  `;
}

function badge(label, tone) {
  return `<span class="guest-badge guest-badge--${escapeAttribute(String(tone).toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(label)}</span>`;
}

function renderReservationReadinessBadge(guest) {
  if (!isSeatingEnabled()) return "";
  const readiness = getGuestSeatReadiness(guest);
  const label = readiness.ready
    ? "Reservation Ready"
    : "Seat Assignment Missing";
  const tone = readiness.ready ? "reservation-ready" : "reservation-missing";
  const detail = `${readiness.assignedCount} of ${readiness.requiredCount} seats assigned`;
  return `<span class="guest-badge guest-badge--${tone}" title="${escapeAttribute(detail)}" aria-label="${escapeAttribute(`${label}: ${detail}`)}">${escapeHtml(label)}</span>`;
}

async function handleAction(action, dataset, event = null) {
  switch (action) {
    case "open-add-guest":
      await openGuestModal();
      return;
    case "open-bulk-add":
      openBulkAddModal();
      return;
    case "open-sender": {
      if (!ensureSenderSeatsReady(dataset.id || "all")) {
        return;
      }
      const senderLink = buildSenderLink(dataset.id || "all");
      const senderWindow = window.open(senderLink, "_blank", "noopener");
      if (!senderWindow) {
        await copyText(senderLink);
        showToast(
          "Popup blocked — the sender link was copied instead.",
          "info",
        );
      }
      return;
    }
    case "open-sender-anyway": {
      const senderLink = buildSenderLink(dataset.id || "all");
      elements.missingSeatsModal?.close();
      const senderWindow = window.open(senderLink, "_blank", "noopener");
      if (!senderWindow) {
        await copyText(senderLink);
        showToast(
          "Popup blocked — the sender link was copied instead.",
          "info",
        );
      }
      return;
    }
    case "copy-sender":
      if (!ensureSenderSeatsReady(dataset.id || "all")) {
        return;
      }
      await copyText(buildSenderLink(dataset.id || "all"));
      return;
    case "open-side-view": {
      const sideViewLink = buildSideViewLink(dataset.id || "groom");
      const sideViewWindow = window.open(sideViewLink, "_blank", "noopener");
      if (!sideViewWindow) {
        await copyText(sideViewLink);
        showToast(
          "Popup blocked — the side page link was copied instead.",
          "info",
        );
      }
      return;
    }
    case "copy-side-view":
      await copyText(buildSideViewLink(dataset.id || "groom"));
      return;
    case "open-add-table":
      openTableModal();
      return;
    case "open-add-dance-floor":
      openDanceFloorModal();
      return;
    case "refresh-dashboard":
      if (state.mode === "live") {
        await bootstrapDashboard();
      } else {
        renderAll();
      }
      showToast("Dashboard refreshed.", "success");
      return;
    case "reload-dashboard":
      window.location.reload();
      return;
    case "save-event-settings":
      return;
    case "complete-event":
    case "reopen-event":
      await updateEventLifecycle(action);
      return;
    case "nav-seating":
      switchView("seating");
      return;
    case "open-seating-for-guest":
      elements.missingSeatsModal?.close();
      openSeatingGuestFlow(dataset.guestId || "");
      return;
    case "open-checkin":
      window.open(
        new URL(
          `checkin.html?wedding=${encodeURIComponent(state.weddingId)}`,
          window.location.href,
        ).toString(),
        "_blank",
        "noopener",
      );
      return;
    case "open-dashboard":
      window.open(
        new URL(
          `dashboard.html?wedding=${encodeURIComponent(state.weddingId)}`,
          window.location.href,
        ).toString(),
        "_blank",
        "noopener",
      );
      return;
    case "open-invitation-preview": {
      const guest = state.guests[0];
      if (guest && !(await ensurePublicGuestMirror(guest))) return;
      const url = buildInviteLink(guest?.guestToken || "{guestToken}");
      window.open(url, "_blank", "noopener");
      return;
    }
    case "copy-invitation-base":
      await copyText(
        new URL(
          `index.html?wedding=${encodeURIComponent(state.weddingId)}&guest={guestToken}`,
          window.location.href,
        ).toString(),
      );
      return;
    case "copy-dashboard":
      await copyText(
        new URL(
          `dashboard.html?wedding=${encodeURIComponent(state.weddingId)}`,
          window.location.href,
        ).toString(),
      );
      return;
    case "copy-checkin":
      await copyText(
        new URL(
          `checkin.html?wedding=${encodeURIComponent(state.weddingId)}`,
          window.location.href,
        ).toString(),
      );
      return;
    case "copy-seating-login":
      await copyText(seatingAccountLoginLink());
      return;
    case "generate-seating-access":
      await manageSeatingAccess(dataset.id, "generate");
      return;
    case "regenerate-seating-access":
      if (
        window.confirm(
          `Regenerate this link? The previous ${dataset.id} link will stop working immediately.`,
        )
      ) {
        await manageSeatingAccess(dataset.id, "regenerate");
      }
      return;
    case "revoke-seating-access":
      await manageSeatingAccess(dataset.id, "revoke");
      return;
    case "copy-seating-access":
      await manageSeatingAccess(dataset.id, "reveal");
      return;
    case "open-seating-access":
      await manageSeatingAccess(dataset.id, "open");
      return;
    case "copy-preview": {
      const guest = state.guests[0];
      if (guest && !(await ensurePublicGuestMirror(guest))) return;
      await copyText(buildInviteLink(guest?.guestToken || "{guestToken}"));
      return;
    }
    case "export-all":
      await handleExport("all");
      return;
    case "export-confirmed":
      await handleExport("confirmed");
      return;
    case "export-pending":
      await handleExport("pending");
      return;
    case "export-declined":
      await handleExport("declined");
      return;
    case "export-checkedIn":
      await handleExport("checkedIn");
      return;
    case "export-notCheckedIn":
      await handleExport("notCheckedIn");
      return;
    case "export-tables":
      await handleExport("tables");
      return;
    case "export-bride":
      await handleExport("bride");
      return;
    case "export-groom":
      await handleExport("groom");
      return;
    case "bulk-export":
      await handleExport("selected");
      return;
    case "bulk-rsvp-confirmed":
      await updateBulkRsvp("confirmed");
      return;
    case "bulk-rsvp-pending":
      await updateBulkRsvp("pending");
      return;
    case "edit-guest":
      await openGuestModal(
        state.guests.find(
          (item) => item.id === dataset.id || item.id === dataset.guestId,
        ),
      );
      return;
    case "delete-guest":
      await confirmDeleteGuest(dataset.guestId);
      return;
    case "mark-confirmed":
      await updateGuest(dataset.guestId, {
        rsvpStatus: "confirmed",
        updatedAt: serverTimestamp(),
      });
      return;
    case "mark-pending":
      await updateGuest(dataset.guestId, {
        rsvpStatus: "pending",
        updatedAt: serverTimestamp(),
      });
      return;
    case "mark-declined":
      await updateGuest(dataset.guestId, {
        rsvpStatus: "declined",
        updatedAt: serverTimestamp(),
      });
      return;
    case "copy-guest-invite": {
      const guest = state.guests.find(
        (item) => item.id === dataset.id || item.id === dataset.guestId,
      );
      if (guest && (await ensurePublicGuestMirror(guest))) {
        await copyText(buildInviteLink(guest.guestToken));
        showToast("Invitation link copied and ready to open.", "success");
      }
      return;
    }
    case "copy-guest-qr": {
      const guest = state.guests.find((item) => item.id === dataset.guestId);
      if (guest) {
        await copyText(guest.qrCodeValue || buildCheckinLink(guest.guestToken));
      }
      return;
    }
    case "open-reminder": {
      const guest = state.guests.find((item) => item.id === dataset.guestId);
      const url = buildWhatsAppReminderLink(guest);
      if (!url) {
        showToast(
          "This guest does not have a valid phone number yet.",
          "error",
        );
        return;
      }
      if (state.mode === "live") {
        await updateDoc(
          doc(
            state.services.db,
            "weddings",
            state.weddingId,
            "guests",
            guest.id,
          ),
          {
            reminderSentAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        );
      } else {
        guest.reminderSentAt = new Date().toLocaleString();
        persistDemoDashboardState();
      }
      window.open(url, "_blank", "noopener");
      showToast("Reminder link opened.", "success");
      return;
    }
    case "toggle-checkin": {
      const guest = state.guests.find((item) => item.id === dataset.guestId);
      if (!guest) {
        return;
      }
      await updateGuest(guest.id, {
        checkedIn: !guest.checkedIn,
        checkedInAt: !guest.checkedIn ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
      return;
    }
    case "toggle-guest-menu":
      if (state.activeGuestMenu?.guestId === dataset.guestId) {
        closeGuestMenu();
        return;
      }
      closeGuestMenu({ restoreFocus: false });
      {
        const guest = state.guests.find((item) => item.id === dataset.guestId);
        const trigger = event?.target?.closest(
          ".guest-row__menu-toggle[data-action='toggle-guest-menu']",
        );
        if (guest && trigger) {
          renderGuestActionMenu(guest, trigger);
        }
      }
      return;
    case "guest-page-prev":
      state.guestPageIndex = Math.max(0, state.guestPageIndex - 1);
      closeGuestMenu({ restoreFocus: false });
      renderActiveView();
      return;
    case "guest-page-next":
      state.guestPageIndex += 1;
      closeGuestMenu({ restoreFocus: false });
      renderActiveView();
      return;
    case "planner-zoom-in":
      setPlannerZoom(state.plannerZoom + 0.05);
      return;
    case "planner-zoom-out":
      setPlannerZoom(state.plannerZoom - 0.05);
      return;
    case "planner-zoom-reset":
      resetPlannerView();
      return;
    case "mobile-set-seating-mode":
      state.mobileSeatingMode = dataset.mode === "edit" ? "edit" : "assign";
      state.mobileMapOpen = false;
      document.body.classList.remove("is-mobile-map-open");
      renderActiveView();
      return;
    case "mobile-seating-view":
      state.mobileSeatingView = dataset.view === "map" ? "map" : "tables";
      renderActiveView();
      return;
    case "mobile-toggle-seating-summary":
      state.showFullSeatingSummary = !state.showFullSeatingSummary;
      renderActiveView();
      return;
    case "mobile-explore-map":
      state.mobileSavedScrollY = window.scrollY;
      state.mobileMapOpen = true;
      document.body.classList.add("is-mobile-map-open");
      renderActiveView();
      document.querySelector(".mobile-map-overlay [data-action='mobile-close-map']")?.focus({ preventScroll: true });
      return;
    case "mobile-close-map":
      state.mobileMapOpen = false;
      document.body.classList.remove("is-mobile-map-open");
      renderActiveView();
      window.scrollTo(0, state.mobileSavedScrollY);
      return;
    case "mobile-browse-table":
      openMobileTableSeatBrowser(dataset.tableId);
      return;
    case "mobile-open-seat": {
      const tableId = dataset.tableId;
      const chairId = dataset.chairId;
      state.assignmentSession = null;
      elements.assignmentModal?.close();
      handleAssignmentChairClick(tableId, chairId, event?.target);
      return;
    }
    case "mobile-assignment-filter":
      state.mobileAssignmentFilter = dataset.filter === "all" ? "all" : "unassigned";
      renderAssignmentWorkflow();
      return;
    case "open-layout-library":
      state.seatingPanelTab = "venue";
      renderActiveView();
      return;
    case "load-test-guests":
      loadSeatingTestGuests();
      return;
    case "select-table":
      state.selectedTableId = dataset.tableId;
      state.selectedHallObjectId = "";
      state.activePartyGuestId = "";
      if (window.matchMedia("(max-width: 700px)").matches && state.mobileSeatingMode !== "edit") {
        openMobileTableSeatBrowser(dataset.tableId);
        return;
      }
      renderActiveView();
      return;
    case "set-seating-panel-tab":
      if (["guests", "venue"].includes(dataset.tab)) {
        state.seatingPanelTab = dataset.tab;
        if (dataset.tab === "guests") {
          state.selectedHallObjectId = "";
          state.selectedTableId = state.selectedTableId || state.tables[0]?.id || "";
          state.activePartyGuestId = "";
        }
        renderActiveView();
      }
      return;
    case "set-seating-guest-filter":
      if (["all", "assigned", "unassigned"].includes(dataset.filter)) {
        state.seatingGuestFilter = dataset.filter;
        renderActiveView();
      }
      return;
    case "locate-seating-guest":
      locateSeatingGuest(dataset.guestId || "");
      return;
    case "select-hall-object":
      state.selectedHallObjectId = dataset.hallObjectId;
      state.selectedTableId = "";
      state.activePartyGuestId = "";
      state.seatingPanelTab = "venue";
      renderActiveView();
      return;
    case "edit-dance-floor":
      openDanceFloorModal(getSelectedHallObject());
      return;
    case "duplicate-dance-floor":
      await duplicateDanceFloor(dataset.id);
      return;
    case "delete-dance-floor":
      await deleteDanceFloor(dataset.id);
      return;
    case "toggle-hall-object-lock":
      await toggleHallObjectLock(dataset.id);
      return;
    case "edit-table":
      openTableModal(getSelectedTable());
      return;
    case "duplicate-table": {
      const table = state.tables.find((item) => item.id === dataset.id);
      if (table) {
        await duplicateTable(table);
      }
      return;
    }
    case "delete-table":
      await confirmDeleteTable(dataset.id);
      return;
    case "assign-seat":
      await assignGuestToChair(
        dataset.tableId,
        dataset.chairId,
        dataset.guestId,
      );
      return;
    case "clear-seat": {
      const [tableId, chairId] = String(dataset.id || "").split("::");
      await confirmUnassignSeat(tableId, chairId);
      return;
    }
    case "select-seat":
      state.selectedTableId = dataset.tableId;
      state.selectedSeatId = buildSeatKey(dataset.tableId, dataset.chairId);
      handleAssignmentChairClick(
        dataset.tableId,
        dataset.chairId,
        event?.target,
      );
      return;
    case "choose-assignment-guest":
      chooseGuestForAssignment(dataset.guestId);
      return;
    case "complete-assignment":
      await completeAssignmentSession();
      return;
    case "cancel-assignment":
      cancelAssignmentSession();
      elements.assignmentModal?.close();
      renderActiveView();
      return;
    case "move-party":
      beginMoveParty(dataset.guestId || dataset.id);
      return;
    case "move-party-destination":
      await confirmMovePartyToTable(dataset.guestId, dataset.tableId);
      return;
    case "unassign-seat":
      await confirmUnassignSeat(dataset.tableId, dataset.chairId);
      return;
    case "unassign-party":
      await unassignParty(dataset.guestId || dataset.id);
      return;
    case "confirm-unassign-party":
      await confirmPartyUnassign(
        dataset.guestId || state.pendingPartyUnassignId,
      );
      return;
    case "cancel-unassign-party":
      state.pendingPartyUnassignId = "";
      state.pendingPartyUnassignSignature = "";
      renderChairDetailsModal(dataset.guestId || state.activePartyGuestId);
      return;
    default:
      return;
  }
}

function calculateDashboardStats(guests, tables) {
  const directoryCounts = calculateGuestDirectoryCounts(guests);
  const totalSeats = tables.reduce(
    (sum, table) => sum + Number(table.seatCount || table.capacity || 0),
    0,
  );
  const assignedSeats = countAssignedSeats(tables);
  const seatedGuests = guests.filter(
    (guest) => getGuestAssignedSeats(guest.id, tables).length > 0,
  ).length;
  const withoutSeat = guests.filter(
    (guest) =>
      guest.rsvpStatus === "confirmed" &&
      getGuestRemainingSeats(guest, tables) > 0,
  ).length;
  // A guest record may represent a group. Count each incomplete record once
  // here, rather than incorrectly presenting every unseated party member as a
  // separate “guest”.
  const unassignedGuestParties = guests.filter(
    (guest) => getGuestRemainingSeats(guest, tables) > 0,
  ).length;
  const total = guests.length;
  const confirmed = guests.filter(
    (guest) => guest.rsvpStatus === "confirmed",
  ).length;
  const pending = guests.filter(
    (guest) => guest.rsvpStatus === "pending",
  ).length;
  const declined = guests.filter(
    (guest) => guest.rsvpStatus === "declined",
  ).length;
  const checkedIn = guests.filter((guest) => guest.checkedIn).length;
  return {
    total,
    accompanyingGuests: directoryCounts.accompanying,
    totalPeople: directoryCounts.people,
    confirmed,
    pending,
    declined,
    checkedIn,
    notCheckedIn: guests.filter((guest) => !guest.checkedIn).length,
    totalSeats,
    seatedGuests,
    assignedSeats,
    unassignedGuests: unassignedGuestParties,
    remainingSeats: Math.max(0, totalSeats - assignedSeats),
    withoutSeat,
    confirmedPct: percentage(confirmed, total),
    pendingPct: percentage(pending, total),
    declinedPct: percentage(declined, total),
    checkinPct: percentage(checkedIn, total),
    withoutSeatPct: percentage(withoutSeat, Math.max(confirmed, 1)),
  };
}

function calculateAttention(guests, tables) {
  const confirmedWithoutTables = guests.filter(
    (guest) =>
      guest.rsvpStatus === "confirmed" && getGuestRemainingSeats(guest) > 0,
  ).length;
  const pendingGuests = guests.filter(
    (guest) => guest.rsvpStatus === "pending",
  ).length;
  const incompleteInfo = guests.filter(
    (guest) => !guest.phone || !guest.fullName,
  ).length;
  const overCapacity = tables.filter(
    (table) =>
      getTableAssignments(table.id).length >
      Number(table.seatCount || table.capacity || 0),
  ).length;
  const conflicts = guests.filter(
    (guest) =>
      guest.rsvpStatus === "declined" &&
      getGuestAssignedSeats(guest.id).length > 0,
  ).length;

  return [
    {
      count: confirmedWithoutTables,
      title: `${confirmedWithoutTables} confirmed guest${confirmedWithoutTables === 1 ? "" : "s"} without tables`,
      description: "These guests accepted but still need a final placement.",
    },
    {
      count: pendingGuests,
      title: `${pendingGuests} pending RSVP${pendingGuests === 1 ? "" : "s"}`,
      description: "Useful for reminder follow-up and late seating decisions.",
    },
    {
      count: overCapacity,
      title: `${overCapacity} table${overCapacity === 1 ? "" : "s"} over capacity`,
      description:
        "Check manual edits or seat conflicts that exceed the available chairs.",
    },
    {
      count: incompleteInfo,
      title: `${incompleteInfo} guest profile${incompleteInfo === 1 ? "" : "s"} incomplete`,
      description:
        "Phone or profile details are missing and may block reminders or coordination.",
    },
    {
      count: conflicts,
      title: `${conflicts} declined guest${conflicts === 1 ? "" : "s"} still seated`,
      description: "Useful conflict warning before finalizing the floor plan.",
    },
  ].filter((item) => item.count > 0);
}

function deriveRecentActivity(guests) {
  const items = [];
  guests.forEach((guest) => {
    if (guest.checkedInAt) {
      items.push({
        type: "checkin",
        sortKey: toTimeValue(guest.checkedInAt),
        title: `${guest.fullName || "Guest"} checked in`,
        subtitle: formatTimestamp(guest.checkedInAt),
      });
    }
    if (guest.updatedAt && guest.rsvpStatus) {
      items.push({
        type: "rsvp",
        sortKey: toTimeValue(guest.updatedAt),
        title: `${guest.fullName || "Guest"} RSVP is ${guest.rsvpStatus}`,
        subtitle: `Updated ${formatTimestamp(guest.updatedAt)}`,
      });
    }
    if (guest.createdAt) {
      items.push({
        type: "guest",
        sortKey: toTimeValue(guest.createdAt),
        title: `${guest.fullName || "Guest"} added to the event`,
        subtitle: formatTimestamp(guest.createdAt),
      });
    }
    if (guest.reminderSentAt) {
      items.push({
        type: "reminder",
        sortKey: toTimeValue(guest.reminderSentAt),
        title: `Reminder prepared for ${guest.fullName || "guest"}`,
        subtitle: formatTimestamp(guest.reminderSentAt),
      });
    }
  });
  return items.sort((a, b) => b.sortKey - a.sortKey).slice(0, 4);
}

function calculateSideStats(guests, tables = state.tables) {
  const buckets = {
    groom: emptySideBucket(),
    bride: emptySideBucket(),
    other: emptySideBucket(),
  };

  guests.forEach((guest) => {
    const bucket = buckets[guest.side] || buckets.other;
    const partySize = getPartySize(guest);
    bucket.guestCount += 1;
    bucket.partyTotal += partySize;
    if (guest.rsvpStatus === "confirmed") {
      bucket.confirmed += 1;
      bucket.confirmedSeats += partySize;
      if (getGuestRemainingSeats(guest, tables) === 0) {
        bucket.seated += 1;
      }
    } else if (guest.rsvpStatus === "declined") {
      bucket.declined += 1;
    } else {
      bucket.pending += 1;
    }
  });

  return buckets;
}

function emptySideBucket() {
  return {
    guestCount: 0,
    partyTotal: 0,
    confirmed: 0,
    confirmedSeats: 0,
    pending: 0,
    declined: 0,
    seated: 0,
  };
}

function getFilteredGuests() {
  const search = state.guestFilters.search.trim().toLowerCase();
  const sorted = [...state.guests].filter((guest) => {
    const matchesSearch =
      !search ||
      [guest.fullName, guest.phone].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(search),
      );
    if (!matchesSearch) {
      return false;
    }
    if (
      state.guestFilters.rsvp !== "all" &&
      guest.rsvpStatus !== state.guestFilters.rsvp
    ) {
      return false;
    }
    if (
      state.guestFilters.side !== "all" &&
      guest.side !== state.guestFilters.side
    ) {
      return false;
    }
    return true;
  });

  sorted.sort((a, b) =>
    String(a.fullName || "").localeCompare(
      String(b.fullName || ""),
      undefined,
      { sensitivity: "base" },
    ),
  );

  return sorted;
}

function normalizeAdditionalGuests(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function getPartySize(guest) {
  return 1 + normalizeAdditionalGuests(guest?.additionalGuests);
}

function personKeyForIndex(index) {
  return Number(index) === 0 ? "main" : `guest-${Number(index)}`;
}

function partyLabelForIndex(index) {
  return Number(index) === 0 ? "Main Guest" : `Guest ${Number(index)}`;
}

function partyIndexFromKey(personKey) {
  if (personKey === "main") {
    return 0;
  }
  const match = String(personKey || "").match(/^guest-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function normalizeAssignment(assignment, tableId, chair) {
  if (!assignment && !chair?.guestId) {
    return null;
  }
  const guestId = String(assignment?.guestId || chair?.guestId || "");
  if (!guestId) {
    return null;
  }
  const partyMemberIndex = Number.isInteger(
    Number(assignment?.partyMemberIndex),
  )
    ? Number(assignment.partyMemberIndex)
    : partyIndexFromKey(assignment?.personKey);
  return {
    tableId: assignment?.tableId || tableId,
    tableName: assignment?.tableName || "",
    seatNumber: Number(assignment?.seatNumber || chair?.seatNumber || 0),
    guestId,
    partyMemberIndex,
    personKey: assignment?.personKey || personKeyForIndex(partyMemberIndex),
    label: assignment?.label || partyLabelForIndex(partyMemberIndex),
    isMainGuest: partyMemberIndex === 0,
  };
}

function getChairAssignment(tableId, chair) {
  return normalizeAssignment(chair?.assignment, tableId, chair);
}

function getAllAssignments(tables = state.tables) {
  return tables.flatMap((table) =>
    (table.chairs || [])
      .map((chair) => {
        const assignment = getChairAssignment(table.id, chair);
        return assignment
          ? { ...assignment, chairId: chair.id, tableName: resolveTableName(table), chair }
          : null;
      })
      .filter(Boolean),
  );
}

function getTableAssignments(tableId) {
  return getAllAssignments().filter(
    (assignment) => assignment.tableId === tableId,
  );
}

function getGuestAssignedSeats(guestId, tables = state.tables) {
  if (!guestId) {
    return [];
  }
  return assignmentsForGuest(getAllAssignments(tables), guestId);
}

function countAssignedSeats(tables = state.tables) {
  return getAllAssignments(tables).length;
}

function getGuestRemainingSeats(guest, tables = state.tables) {
  return summarizePartySeating(
    guest,
    getGuestAssignedSeats(getGuestDocumentId(guest), tables),
  ).remainingCount;
}

function getGuestDocumentId(guest) {
  return String(guest?.id || guest?.guestId || "");
}

function uniqueGuestsFromAssignments(assignments) {
  const seen = new Set();
  return assignments
    .map((assignment) =>
      state.guests.find((guest) => guest.id === assignment.guestId),
    )
    .filter((guest) => {
      if (!guest || seen.has(guest.id)) {
        return false;
      }
      seen.add(guest.id);
      return true;
    });
}

function partyMemberLabel(guest, partyMemberIndex) {
  return partyLabelForIndex(partyMemberIndex);
}

// Firestore web transactions can only read document references here.  Keep the
// collection query outside the transaction, then re-read every discovered
// table reference inside it before calculating or writing seating changes.
// This gives the transaction a consistent snapshot without passing a Query to
// transaction.get(), which otherwise fails before our validation can run.
async function getLiveTableRefs() {
  const snapshot = await getDocs(
    collection(state.services.db, "weddings", state.weddingId, "tables"),
  );
  return snapshot.docs.map((tableSnapshot) => tableSnapshot.ref);
}

async function getLiveTablesInTransaction(transaction, tableRefs) {
  const tableSnapshots = await Promise.all(
    tableRefs.map((tableRef) => transaction.get(tableRef)),
  );
  return hydrateTables(
    tableSnapshots
      .filter((tableSnapshot) => tableSnapshot.exists())
      .map((tableSnapshot) => ({
        ...tableSnapshot.data(),
        id: tableSnapshot.id,
      })),
  );
}

async function getPublicGuestMirrorInTransaction(transaction, guest) {
  if (!guest?.guestToken) return null;
  return transaction.get(
    doc(
      state.services.db,
      "weddings",
      state.weddingId,
      "publicGuests",
      guest.guestToken,
    ),
  );
}

function updatePublicGuestSeatingMirrorInTransaction(
  transaction,
  mirrorSnapshot,
  guest,
) {
  if (mirrorSnapshot?.exists()) {
    transaction.update(mirrorSnapshot.ref, buildGuestSeatingPatch(guest));
  }
}

// A party is represented by one real guest document. Every chair belonging to
// that party carries that stable guest document ID plus a personKey/index for
// the main guest or an additional member; there are no separate guest records
// to guess from display names.
function resolvePartyForGuestId(guestId, tables = state.tables) {
  const guest = state.guests.find(
    (item) => String(item.id) === String(guestId),
  );
  if (!guest) return null;
  const assignments = getGuestAssignedSeats(guest.id, tables).sort(
    (a, b) => Number(a.partyMemberIndex) - Number(b.partyMemberIndex),
  );
  return {
    partyGuestId: guest.id,
    guest,
    partySize: getPartySize(guest),
    assignments,
    affectedTables: [
      ...new Set(
        assignments
          .map((assignment) => assignment.tableName || assignment.tableId)
          .filter(Boolean),
      ),
    ],
  };
}

function partyAssignmentSignature(party) {
  return (party?.assignments || [])
    .map(
      (assignment) =>
        `${assignment.tableId}::${assignment.chairId}::${assignment.personKey}`,
    )
    .sort()
    .join("|");
}

function parseAdditionalGuests(value) {
  const trimmed = normalizeDigits(String(value ?? "").trim());
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toggleGuestSelection(guestId, checked) {
  const next = new Set(state.selectedGuestIds);
  if (checked) {
    next.add(guestId);
  } else {
    next.delete(guestId);
  }
  state.selectedGuestIds = [...next];
}

function toggleAllVisibleGuests(checked) {
  const visibleGuestIds = getFilteredGuests().map((guest) => guest.id);
  const next = new Set(state.selectedGuestIds);
  visibleGuestIds.forEach((guestId) => {
    if (checked) {
      next.add(guestId);
    } else {
      next.delete(guestId);
    }
  });
  state.selectedGuestIds = [...next];
}

function allVisibleGuestsSelected(guests) {
  return (
    Boolean(guests.length) &&
    guests.every((guest) => state.selectedGuestIds.includes(guest.id))
  );
}

async function updateBulkRsvp(status) {
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }

  const ids = [...state.selectedGuestIds];
  if (!ids.length) {
    return;
  }

  if (state.mode === "demo") {
    state.guests = state.guests.map((guest) =>
      ids.includes(guest.id)
        ? {
            ...guest,
            rsvpStatus: status,
            updatedAt: new Date().toLocaleString(),
          }
        : guest,
    );
    persistDemoDashboardState();
    renderAll();
    showToast("Selected guests updated.", "success");
    return;
  }

  try {
    const chunkSize = 200;
    for (let index = 0; index < ids.length; index += chunkSize) {
      const batch = writeBatch(state.services.db);
      ids.slice(index, index + chunkSize).forEach((guestId) => {
        batch.update(
          doc(
            state.services.db,
            "weddings",
            state.weddingId,
            "guests",
            guestId,
          ),
          {
            rsvpStatus: status,
            updatedAt: serverTimestamp(),
          },
        );
        const guest = state.guests.find((item) => item.id === guestId);
        if (guest?.guestToken) {
          batch.set(
            doc(
              state.services.db,
              "weddings",
              state.weddingId,
              "publicGuests",
              guest.guestToken,
            ),
            { rsvpStatus: status, updatedAt: serverTimestamp() },
            { merge: true },
          );
        }
      });
      await batch.commit();
    }
    showToast("Selected guests updated.", "success");
  } catch (error) {
    console.error(error);
    showToast("Bulk update failed.", "error");
  }
}

async function openGuestModal(guest = null) {
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }

  state.selectedGuestId = guest?.id || "";
  state.dirtyGuestForm = false;
  elements.guestModalTitle.textContent = guest ? "Edit Guest" : "Add Guest";
  elements.guestDeleteButton.hidden = !guest;
  elements.guestForm.reset();
  elements.guestForm.fullName.value = guest?.fullName || "";
  elements.guestForm.phone.value = guest?.phone || "";
  const sideControl = elements.guestForm.querySelector("[data-wedding-side-control]");
  const sideSelect = sideControl?.querySelector("select");
  const usesGuestSides = eventUsesGuestSides(state.wedding);
  if (sideControl) sideControl.hidden = !usesGuestSides;
  if (sideSelect) {
    sideSelect.disabled = !usesGuestSides;
    sideSelect.value = usesGuestSides
      ? guest?.side || "bride"
      : getDefaultGuestSide(state.wedding);
  }
  elements.guestForm.additionalGuests.value = String(
    normalizeAdditionalGuests(guest?.additionalGuests),
  );
  document.body.classList.add("is-modal-open");
  elements.guestModal.showModal();
  requestAnimationFrame(() => elements.guestForm.fullName.focus());
}

async function saveGuest(event) {
  event.preventDefault();
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }
  const guestId = state.selectedGuestId;
  const existingGuest = guestId
    ? state.guests.find((item) => item.id === guestId)
    : null;
  const token = existingGuest?.guestToken || generateGuestToken();
  const fullName = elements.guestForm.fullName.value.trim();
  if (!fullName) {
    elements.guestForm.fullName.setCustomValidity(
      "Enter the guest's full name.",
    );
    elements.guestForm.reportValidity();
    return;
  }
  elements.guestForm.fullName.setCustomValidity("");
  const additionalGuests = parseAdditionalGuests(
    elements.guestForm.additionalGuests.value,
  );
  if (additionalGuests === null) {
    elements.guestForm.additionalGuests.setCustomValidity(
      "Enter a whole number of 0 or more.",
    );
    elements.guestForm.reportValidity();
    return;
  }
  elements.guestForm.additionalGuests.setCustomValidity("");
  const assignedSeats = guestId ? getGuestAssignedSeats(guestId).length : 0;
  if (assignedSeats > 1 + additionalGuests) {
    elements.guestForm.additionalGuests.setCustomValidity(
      `This guest already has ${assignedSeats} assigned chairs. Unassign or move seats before reducing the party size.`,
    );
    elements.guestForm.reportValidity();
    return;
  }
  elements.guestForm.additionalGuests.setCustomValidity("");

  const ownedPayload = {
    fullName,
    phone: elements.guestForm.phone.value.trim(),
    side: eventUsesGuestSides(state.wedding)
      ? normalizeGuestSide(elements.guestForm.side.value)
      : existingGuest?.side || "general",
    additionalGuests,
    updatedAt: serverTimestamp(),
  };
  const createPayload = {
    ...ownedPayload,
    rsvpStatus: "pending",
    guestToken: token,
    inviteLink: buildInviteLink(token),
    tableId: "",
    tableName: "",
    seatNumber: "",
    qrCodeValue: buildCheckinLink(token),
    checkedIn: false,
    checkedInAt: null,
    notes: "",
    inviteSentAt: null,
    reminderSentAt: null,
  };

  if (state.mode === "demo") {
    const demoPayload = materializeDemoPayload(
      guestId ? ownedPayload : createPayload,
      existingGuest,
    );
    if (guestId) {
      state.guests = state.guests.map((guest) =>
        guest.id === guestId ? { ...guest, ...demoPayload } : guest,
      );
    } else {
      state.guests = [
        ...state.guests,
        {
          id: createId("guest"),
          ...demoPayload,
          createdAt: demoNow(),
        },
      ];
    }
    state.dirtyGuestForm = false;
    elements.guestModal.close();
    state.tables = hydrateTables(state.tables);
    persistDemoDashboardState();
    renderAll();
    showToast("Guest saved successfully.", "success");
    return;
  }

  try {
    if (guestId) {
      await updateDoc(
        doc(state.services.db, "weddings", state.weddingId, "guests", guestId),
        ownedPayload,
      );
      await syncPublicGuest(guestId, { ...existingGuest, ...ownedPayload }, [
        "fullName",
        "phone",
        "side",
        "additionalGuests",
      ]);
    } else {
      const guestRef = await addDoc(
        collection(state.services.db, "weddings", state.weddingId, "guests"),
        {
          ...createPayload,
          createdAt: serverTimestamp(),
        },
      );
      await syncPublicGuest(guestRef.id, createPayload);
    }
    state.dirtyGuestForm = false;
    elements.guestModal.close();
    await syncTablesAndGuests();
    showToast("Guest saved successfully.", "success");
  } catch (error) {
    console.error(error);
    showToast("We could not save this guest.", "error");
  }
}

function buildPublicGuestPayload(guestId, guest) {
  return {
    guestId,
    guestToken: guest.guestToken || "",
    fullName: guest.fullName || "",
    side: String(guest.side || getDefaultGuestSide(state.wedding)).toLowerCase() === "general"
      ? "general"
      : normalizeGuestSide(guest.side),
    additionalGuests: normalizeAdditionalGuests(guest.additionalGuests),
    rsvpStatus: guest.rsvpStatus || "pending",
    seatingAssignments: Array.isArray(guest.seatingAssignments)
      ? guest.seatingAssignments
      : [],
    tableId: guest.tableId || "",
    tableName: guest.tableName || "",
    seatNumber: guest.seatNumber || "",
    updatedAt: serverTimestamp(),
  };
}

const publicGuestMirrorKeys = [
  "fullName",
  "side",
  "additionalGuests",
  "rsvpStatus",
  "seatingAssignments",
  "tableId",
  "tableName",
  "seatNumber",
];

async function reconcilePublicGuestMirrors(guests) {
  if (state.mode !== "live" || !can("canEditGuests")) return;
  const eligibleGuests = guests.filter((guest) => Boolean(guest.guestToken));
  try {
    // set() without merge is deliberate: it removes legacy private fields
    // such as phone/notes from public documents and cannot create duplicates
    // because every mirror has the stable guestToken as its document ID.
    for (let offset = 0; offset < eligibleGuests.length; offset += 400) {
      const batch = writeBatch(state.services.db);
      eligibleGuests.slice(offset, offset + 400).forEach((guest) => {
        batch.set(
          doc(
            state.services.db,
            "weddings",
            state.weddingId,
            "publicGuests",
            guest.guestToken,
          ),
          buildPublicGuestPayload(guest.id, guest),
        );
      });
      await batch.commit();
    }
    console.info(
      "[Dashboard Firestore diagnostics] public mirrors reconciled",
      {
        weddingId: state.weddingId,
        mirroredGuestCount: eligibleGuests.length,
        skippedWithoutToken: guests.length - eligibleGuests.length,
      },
    );
  } catch (error) {
    state.publicMirrorsReconciled = false;
    console.error("Public guest mirror reconciliation failed.", error);
    showToast(
      "Guest data is live, but invitation records could not be synchronized.",
      "error",
    );
  }
}

// fields === null writes the full mirror doc (guest creation only). Update
// paths must pass the changed field names so a patch from stale local state
// can never clobber values other actors own (e.g. the guest's own RSVP).
async function syncPublicGuest(guestId, guest, fields = null) {
  if (state.mode !== "live" || !guest?.guestToken) {
    return;
  }
  try {
    const mirrorRef = doc(
      state.services.db,
      "weddings",
      state.weddingId,
      "publicGuests",
      guest.guestToken,
    );
    if (!fields) {
      await setDoc(mirrorRef, buildPublicGuestPayload(guestId, guest));
      return;
    }
    const fullPayload = buildPublicGuestPayload(guestId, guest);
    const patch = { updatedAt: serverTimestamp() };
    fields
      .filter((key) => publicGuestMirrorKeys.includes(key))
      .forEach((key) => {
        patch[key] = fullPayload[key];
      });
    await setDoc(mirrorRef, patch, { merge: true });
  } catch (error) {
    console.error("Public invitation mirror update failed.", error);
    showToast(
      "Saved, but the guest's public invitation page could not be refreshed.",
      "error",
    );
  }
}

async function removePublicGuest(guestToken) {
  if (state.mode !== "live" || !guestToken) {
    return;
  }
  try {
    await deleteDoc(
      doc(
        state.services.db,
        "weddings",
        state.weddingId,
        "publicGuests",
        guestToken,
      ),
    );
  } catch (error) {
    console.error("Public invitation mirror delete failed.", error);
  }
}

function bulkAddHasContent() {
  return Boolean(elements.bulkAddForm?.entries?.value.trim());
}

function openBulkAddModal() {
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }
  elements.bulkAddForm?.reset();
  updateBulkAddPreview();
  document.body.classList.add("is-modal-open");
  elements.bulkAddModal.showModal();
  requestAnimationFrame(() => {
    elements.bulkAddForm?.entries?.focus();
  });
}

function parseBulkEntries(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,،\t]/).map((part) => part.trim());
      const additionalGuests = parseAdditionalGuests(parts[2] || "0");
      return {
        fullName: parts[0] || "",
        phone: cleanPhone(parts[1] || ""),
        additionalGuests: additionalGuests === null ? 0 : additionalGuests,
      };
    })
    .filter((entry) => entry.fullName);
}

function updateBulkAddPreview() {
  if (!elements.bulkAddPreview) {
    return;
  }
  const entries = parseBulkEntries(elements.bulkAddForm?.entries?.value);
  const withPhone = entries.filter((entry) => entry.phone).length;
  elements.bulkAddPreview.textContent = entries.length
    ? `${entries.length} guest${entries.length === 1 ? "" : "s"} ready to add · ${withPhone} with phone numbers`
    : "Nothing to add yet — paste at least one line.";
}

async function saveBulkGuests(event) {
  event.preventDefault();
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }
  const entries = parseBulkEntries(elements.bulkAddForm.entries.value);
  if (!entries.length) {
    showToast("Add at least one guest line first.", "error");
    return;
  }
  const side = eventUsesGuestSides(state.wedding)
    ? normalizeGuestSide(elements.bulkAddForm.side.value)
    : "general";
  const payloads = entries.map((entry) => {
    const token = generateGuestToken();
    return {
      fullName: entry.fullName,
      phone: entry.phone,
      side,
      additionalGuests: entry.additionalGuests,
      rsvpStatus: "pending",
      guestToken: token,
      inviteLink: buildInviteLink(token),
      tableId: "",
      tableName: "",
      seatNumber: "",
      qrCodeValue: buildCheckinLink(token),
      checkedIn: false,
      checkedInAt: null,
      notes: "",
      inviteSentAt: null,
      reminderSentAt: null,
      updatedAt: serverTimestamp(),
    };
  });

  if (state.mode === "demo") {
    state.guests = [
      ...state.guests,
      ...payloads.map((payload) => ({
        id: createId("guest"),
        ...materializeDemoPayload(payload),
        createdAt: demoNow(),
      })),
    ];
    elements.bulkAddModal.close();
    persistDemoDashboardState();
    renderAll();
    showToast(
      `${payloads.length} guest${payloads.length === 1 ? "" : "s"} added.`,
      "success",
    );
    return;
  }

  let committed = 0;
  try {
    const chunkSize = 200;
    for (let index = 0; index < payloads.length; index += chunkSize) {
      const chunk = payloads.slice(index, index + chunkSize);
      const batch = writeBatch(state.services.db);
      chunk.forEach((payload) => {
        const guestRef = doc(
          collection(state.services.db, "weddings", state.weddingId, "guests"),
        );
        batch.set(guestRef, { ...payload, createdAt: serverTimestamp() });
        batch.set(
          doc(
            state.services.db,
            "weddings",
            state.weddingId,
            "publicGuests",
            payload.guestToken,
          ),
          buildPublicGuestPayload(guestRef.id, payload),
        );
      });
      await batch.commit();
      committed += chunk.length;
    }
    elements.bulkAddForm.reset();
    elements.bulkAddModal.close();
    showToast(
      `${payloads.length} guest${payloads.length === 1 ? "" : "s"} added.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    if (committed > 0) {
      const remaining = entries.slice(committed);
      elements.bulkAddForm.entries.value = remaining
        .map((entry) =>
          [
            entry.fullName,
            entry.phone,
            entry.additionalGuests || "",
          ]
            .filter(Boolean)
            .join(", "),
        )
        .join("\n");
      updateBulkAddPreview();
      showToast(
        `Added ${committed} guests before an error occurred. The remaining lines are still in the box — press Add again to retry them.`,
        "error",
      );
    } else {
      showToast("We could not add these guests.", "error");
    }
  }
}

async function confirmDeleteGuest(guestId) {
  const guest = state.guests.find((item) => item.id === guestId);
  if (!guest) {
    return;
  }
  const confirmed = window.confirm(
    `Delete ${guest.fullName}? This cannot be undone.`,
  );
  if (!confirmed) {
    return;
  }
  await deleteGuest(guestId);
}

async function updateGuest(guestId, payload) {
  if (state.mode === "demo") {
    const existingGuest = state.guests.find((guest) => guest.id === guestId);
    const demoPayload = materializeDemoPayload(payload, existingGuest);
    state.guests = state.guests.map((guest) =>
      guest.id === guestId ? { ...guest, ...demoPayload } : guest,
    );
    persistDemoDashboardState();
    renderAll();
    showToast("Guest updated.", "success");
    return;
  }
  if (!can("canEditGuests") && !("checkedIn" in payload && can("canCheckIn"))) {
    showToast("Your role does not allow guest editing.", "error");
    return;
  }

  try {
    await updateDoc(
      doc(state.services.db, "weddings", state.weddingId, "guests", guestId),
      payload,
    );
    const existingGuest = state.guests.find((guest) => guest.id === guestId);
    if (existingGuest) {
      await syncPublicGuest(
        guestId,
        { ...existingGuest, ...payload },
        Object.keys(payload),
      );
    }
    await syncTablesAndGuests();
    showToast("Guest updated.", "success");
  } catch (error) {
    console.error(error);
    showToast("Guest update failed.", "error");
  }
}

async function deleteGuest(guestId) {
  if (!can("canEditGuests")) {
    showToast("Your role does not allow guest deletion.", "error");
    return;
  }

  if (state.mode === "demo") {
    const nextTables = clearGuestFromTables(state.tables, guestId);
    const nextGuests = state.guests.filter((guest) => guest.id !== guestId);
    state.guests = nextGuests;
    state.tables = hydrateTables(nextTables, nextGuests);
    state.guests = syncGuestSeatingSummaries(nextGuests, state.tables);
    if (demoSeedGuests.some((seedGuest) => seedGuest.id === guestId)) {
      state.deletedSeedGuestIds = [
        ...new Set([...(state.deletedSeedGuestIds || []), guestId]),
      ];
    }
    persistDemoDashboardState();
    renderAll();
    showToast("Guest deleted.", "success");
    return;
  }

  try {
    const removedGuest = state.guests.find((guest) => guest.id === guestId);
    const batch = writeBatch(state.services.db);
    const nextTables = clearGuestFromTables(state.tables, guestId);
    const nextGuests = state.guests.filter((guest) => guest.id !== guestId);
    nextTables.forEach((table) => {
      batch.update(
        doc(state.services.db, "weddings", state.weddingId, "tables", table.id),
        {
          chairs: table.chairs,
          guestIds: [
            ...new Set(
              table.chairs
                .map((chair) => getChairAssignment(table.id, chair)?.guestId)
                .filter(Boolean),
            ),
          ],
          updatedAt: serverTimestamp(),
        },
      );
    });
    batch.delete(
      doc(state.services.db, "weddings", state.weddingId, "guests", guestId),
    );
    if (removedGuest?.guestToken) {
      batch.delete(
        doc(
          state.services.db,
          "weddings",
          state.weddingId,
          "publicGuests",
          removedGuest.guestToken,
        ),
      );
    }
    await batch.commit();
    state.tables = hydrateTables(nextTables, nextGuests);
    state.guests = syncGuestSeatingSummaries(nextGuests, state.tables);
    state.selectedSeatId = "";
    renderAll();
    showToast("Guest deleted.", "success");
  } catch (error) {
    console.error(error);
    showToast("Guest deletion failed.", "error");
  }
}

function openTableModal(table = null) {
  if (!canManageSeatingLayout()) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  state.selectedTableId = table?.id || "";
  state.dirtyTableForm = false;
  elements.tableModalTitle.textContent = table ? "Edit Table" : "Create Table";
  if (elements.tableDeleteButton) {
    elements.tableDeleteButton.hidden = !table;
  }
  elements.tableForm.reset();
  elements.tableForm.name.value = table ? resolveTableName(table) : "";
  elements.tableForm.shape.value = table?.shape || "round";
  elements.tableForm.seatCount.value = table?.seatCount || table?.capacity || 8;
  elements.tableForm.floorZone.value = table?.floorZone || "";
  elements.tableForm.tableColor.value =
    table?.tableColor || plannerPalette.tableColor;
  elements.tableForm.borderColor.value =
    table?.borderColor || plannerPalette.borderColor;
  elements.tableForm.chairColor.value =
    table?.chairColor || plannerPalette.chairColor;
  elements.tableForm.width.value =
    table?.width || defaultWidthForShape(table?.shape);
  elements.tableForm.height.value =
    table?.height || defaultHeightForShape(table?.shape);
  document.body.classList.add("is-modal-open");
  elements.tableModal.showModal();
}

// Invitation pages intentionally read only the token-keyed public mirror.
// Older guest records can predate that mirror, so create/repair it before an
// owner copies or opens a personal invitation link.
async function ensurePublicGuestMirror(guest) {
  if (state.mode !== "live" || !guest?.guestToken) return true;
  if (!can("canEditGuests")) {
    showToast(
      "This invitation link needs an owner to prepare its secure guest record.",
      "error",
    );
    return false;
  }
  try {
    await setDoc(
      doc(
        state.services.db,
        "weddings",
        state.weddingId,
        "publicGuests",
        guest.guestToken,
      ),
      buildPublicGuestPayload(guest.id, guest),
    );
    return true;
  } catch (error) {
    console.error("Public invitation mirror repair failed.", error);
    showToast(
      "The invitation could not be prepared. Please try again.",
      "error",
    );
    return false;
  }
}

async function saveTable(event) {
  event.preventDefault();
  if (!canManageSeatingLayout()) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  const existingTable = state.tables.find(
    (table) => table.id === state.selectedTableId,
  );
  const payload = createPlannerTable({
    id: state.selectedTableId || createId("table"),
    name: elements.tableForm.name.value.trim(),
    capacity: Number(elements.tableForm.seatCount.value || 0),
    seatCount: Number(elements.tableForm.seatCount.value || 0),
    shape: elements.tableForm.shape.value,
    floorZone: elements.tableForm.floorZone.value.trim(),
    tableColor: elements.tableForm.tableColor.value,
    borderColor: elements.tableForm.borderColor.value,
    chairColor: elements.tableForm.chairColor.value,
    width: Number(elements.tableForm.width.value || 180),
    height: Number(elements.tableForm.height.value || 180),
    x: Number(existingTable?.x ?? 20),
    y: Number(existingTable?.y ?? 20),
    chairs: existingTable?.chairs || [],
  });
  const occupiedSeats = state.selectedTableId
    ? getTableAssignments(state.selectedTableId).length
    : 0;
  if (payload.seatCount < occupiedSeats || payload.capacity < occupiedSeats) {
    showToast(
      `This table has ${occupiedSeats} occupied chairs. Unassign guests before reducing capacity.`,
      "error",
    );
    return;
  }
  const removedAssignedSeat = state.selectedTableId
    ? getTableAssignments(state.selectedTableId).some(
        (assignment) => Number(assignment.seatNumber) > payload.seatCount,
      )
    : false;
  if (removedAssignedSeat) {
    showToast(
      "This seat count would remove an assigned chair. Unassign or move that party first.",
      "error",
    );
    return;
  }

  if (state.mode === "demo") {
    if (state.selectedTableId) {
      state.tables = state.tables.map((table) =>
        table.id === state.selectedTableId ? payload : table,
      );
    } else {
      state.tables = [...state.tables, payload];
    }
    state.tables = hydrateTables(state.tables);
    state.guests = syncGuestSeatingSummaries(state.guests, state.tables);
    state.selectedTableId = payload.id;
    state.selectedHallObjectId = "";
    state.dirtyTableForm = false;
    elements.tableModal.close();
    persistDemoDashboardState();
    renderAll();
    showToast("Table saved successfully.", "success");
    return;
  }

  try {
    if (state.selectedTableId) {
      let affectedGuestIds = [];
      let nextTables = [];
      let nextGuests = [];
      await runTransaction(state.services.db, async (transaction) => {
        const tableRef = doc(
          state.services.db,
          "weddings",
          state.weddingId,
          "tables",
          state.selectedTableId,
        );
        const liveSnapshot = await transaction.get(tableRef);
        if (!liveSnapshot.exists())
          throw new Error(
            "This table no longer exists. The seating plan has been refreshed.",
          );
        const liveTable = hydrateTables([
          { ...liveSnapshot.data(), id: liveSnapshot.id },
        ])[0];
        const livePayload = createPlannerTable({
          ...payload,
          x: liveTable.x,
          y: liveTable.y,
          chairs: liveTable.chairs,
        });
        const liveAssignments = getAllAssignments([liveTable]);
        if (
          livePayload.seatCount < liveAssignments.length ||
          liveAssignments.some(
            (assignment) =>
              Number(assignment.seatNumber) > livePayload.seatCount,
          )
        ) {
          throw new Error(
            "This table changed and now has occupied chairs that prevent the requested capacity.",
          );
        }
        affectedGuestIds = [
          ...new Set(
            liveAssignments
              .map((assignment) => assignment.guestId)
              .filter(Boolean),
          ),
        ];
        nextTables = hydrateTables(
          state.tables.map((table) =>
            table.id === state.selectedTableId ? livePayload : table,
          ),
        );
        nextGuests = syncGuestSeatingSummaries(state.guests, nextTables);
        transaction.update(tableRef, {
          ...livePayload,
          updatedAt: serverTimestamp(),
        });
        affectedGuestIds.forEach((guestId) => {
          const nextGuest = nextGuests.find((guest) => guest.id === guestId);
          if (nextGuest)
            transaction.update(
              doc(
                state.services.db,
                "weddings",
                state.weddingId,
                "guests",
                guestId,
              ),
              buildGuestSeatingPatch(nextGuest),
            );
        });
      });
      state.tables = nextTables;
      state.guests = nextGuests;
      for (const guestId of affectedGuestIds) {
        const nextGuest = nextGuests.find((guest) => guest.id === guestId);
        if (nextGuest) {
          await syncPublicGuest(nextGuest.id, nextGuest, [
            "seatingAssignments",
            "tableId",
            "tableName",
            "seatNumber",
          ]);
        }
      }
    } else {
      const tableRef = doc(
        collection(state.services.db, "weddings", state.weddingId, "tables"),
      );
      await setDoc(tableRef, {
        ...payload,
        id: tableRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    state.dirtyTableForm = false;
    elements.tableModal.close();
    showToast("Table saved successfully.", "success");
  } catch (error) {
    console.error(error);
    showToast("We could not save this table.", "error");
  }
}

async function duplicateTable(table) {
  if (!canManageSeatingLayout()) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  const duplicated = createPlannerTable({
    ...table,
    id: createId("table"),
    name: `${resolveTableName(table)} Copy`,
    x: Number(table.x || 20) + 6,
    y: Number(table.y || 20) + 6,
    chairs: table.chairs.map((chair) => ({
      ...chair,
      id: createId("chair"),
      guestId: "",
      assignment: null,
      status: "available",
    })),
  });

  if (state.mode === "demo") {
    state.tables = [...state.tables, duplicated];
    persistDemoDashboardState();
    renderAll();
    showToast("Table duplicated.", "success");
    return;
  }

  try {
    const tableRef = doc(
      collection(state.services.db, "weddings", state.weddingId, "tables"),
    );
    await setDoc(tableRef, {
      ...duplicated,
      id: tableRef.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showToast("Table duplicated.", "success");
  } catch (error) {
    console.error(error);
    showToast("Table duplication failed.", "error");
  }
}

async function confirmDeleteTable(tableId) {
  openTableDeleteModal(tableId);
}

function openTableDeleteModal(tableId) {
  if (!canManageSeatingLayout()) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }
  state.selectedTableId = tableId;
  state.modalError = "";
  renderTableDeleteModal();
  document.body.classList.add("is-modal-open");
  elements.tableDeleteModal.showModal();
}

function renderTableDeleteModal() {
  const table = state.tables.find((item) => item.id === state.selectedTableId);
  if (!table || !elements.tableDeleteContent) {
    return;
  }
  const assignments = getTableAssignments(table.id);
  const occupied = assignments.length;
  elements.tableDeleteContent.innerHTML = `
    <div class="da3wa-sheet__header">
      <div>
        <p class="da3wa-eyebrow">Delete table</p>
        <h2>${escapeHtml(table.name || "Table")}</h2>
      </div>
      <button class="da3wa-icon-button" type="button" data-close-modal="tableDeleteModal" aria-label="Close delete table modal" ${state.activeModalOperation ? "disabled" : ""}>x</button>
    </div>
    <div class="da3wa-sheet__body">
      <div class="delete-summary-grid">
        ${plannerStat("Table", table.name || "Table")}
        ${plannerStat("Capacity", String(table.seatCount || table.capacity || 0))}
        ${plannerStat("Occupied chairs", String(occupied))}
      </div>
      ${occupied ? `<div class="planner-warning-list"><span class="warning-chip">This table contains assigned guests. Confirming will clear every linked seating assignment before deletion.</span></div>` : ""}
      ${state.modalError ? `<div class="planner-warning-list"><span class="warning-chip">${escapeHtml(state.modalError)}</span></div>` : ""}
    </div>
    <div class="da3wa-sheet__footer">
      <button class="da3wa-button da3wa-button--secondary" type="button" data-close-modal="tableDeleteModal" ${state.activeModalOperation ? "disabled" : ""}>Cancel</button>
      <button class="da3wa-button da3wa-button--danger" type="button" id="tableDeleteConfirmButton" ${state.activeModalOperation ? "disabled" : ""}>${state.activeModalOperation === "delete-table" ? "Deleting..." : "Delete table"}</button>
    </div>
  `;
  elements.tableDeleteContent
    .querySelector("#tableDeleteConfirmButton")
    ?.addEventListener("click", () => {
      void deleteSelectedTableFromModal();
    });
}

async function deleteSelectedTableFromModal() {
  if (state.activeModalOperation) {
    return;
  }
  await deleteTable(state.selectedTableId);
}

async function deleteTable(tableId) {
  if (!canManageSeatingLayout()) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }
  state.activeModalOperation = "delete-table";
  state.modalError = "";
  renderTableDeleteModal();

  if (state.mode === "demo") {
    const remainingTables = state.tables.filter((item) => item.id !== tableId);
    state.tables = hydrateTables(remainingTables);
    state.guests = syncGuestSeatingSummaries(state.guests, state.tables);
    state.selectedTableId = state.tables[0]?.id || "";
    state.selectedSeatId = "";
    state.activeModalOperation = "";
    elements.tableDeleteModal?.close();
    persistDemoDashboardState();
    renderAll();
    showToast("Table deleted.", "success");
    return;
  }

  try {
    let affectedGuestIds = [];
    let nextGuests = [];
    await runTransaction(state.services.db, async (transaction) => {
      const liveTableSnapshot = await transaction.get(
        doc(state.services.db, "weddings", state.weddingId, "tables", tableId),
      );
      if (!liveTableSnapshot.exists())
        throw new Error(
          "This table was changed by another editor. The seating plan has been refreshed.",
        );
      const liveTable = hydrateTables([
        { ...liveTableSnapshot.data(), id: liveTableSnapshot.id },
      ])[0];
      affectedGuestIds = [
        ...new Set(
          getAllAssignments([liveTable])
            .map((assignment) => assignment.guestId)
            .filter(Boolean),
        ),
      ];
      const guestSnapshots = await Promise.all(
        affectedGuestIds.map((guestId) =>
          transaction.get(
            doc(
              state.services.db,
              "weddings",
              state.weddingId,
              "guests",
              guestId,
            ),
          ),
        ),
      );
      const liveGuests = guestSnapshots
        .filter((snapshot) => snapshot.exists())
        .map((snapshot) => ({
          ...snapshot.data(),
          id: snapshot.id,
          ref: snapshot.ref,
        }));
      const publicMirrorSnapshots = await Promise.all(
        liveGuests.map((guest) =>
          getPublicGuestMirrorInTransaction(transaction, guest),
        ),
      );
      nextGuests = liveGuests.map(({ ref, ...guest }) => {
        const assignments = (guest.seatingAssignments || []).filter(
          (assignment) => assignment.tableId !== tableId,
        );
        const primary =
          assignments.find(
            (assignment) => Number(assignment.partyMemberIndex) === 0,
          ) || assignments[0];
        const nextGuest = {
          ...guest,
          seatingAssignments: assignments,
          tableId: primary?.tableId || "",
          tableName: primary?.tableName || "",
          seatNumber: primary ? String(primary.seatNumber) : "",
        };
        return nextGuest;
      });
      nextGuests.forEach((nextGuest, index) => {
        transaction.update(
          liveGuests[index].ref,
          buildGuestSeatingPatch(nextGuest),
        );
        updatePublicGuestSeatingMirrorInTransaction(
          transaction,
          publicMirrorSnapshots[index],
          nextGuest,
        );
      });
      transaction.delete(liveTableSnapshot.ref);
    });
    const nextTables = hydrateTables(
      state.tables.filter((item) => item.id !== tableId),
    );
    state.guests = state.guests.map(
      (guest) => nextGuests.find((item) => item.id === guest.id) || guest,
    );
    state.tables = nextTables;
    state.selectedTableId = state.tables[0]?.id || "";
    state.selectedSeatId = "";
    state.activeModalOperation = "";
    elements.tableDeleteModal?.close();
    renderAll();
    showToast("Table deleted.", "success");
  } catch (error) {
    console.error(error);
    state.activeModalOperation = "";
    state.modalError = error.message || "Table deletion failed.";
    renderTableDeleteModal();
  }
}

function setPlannerZoom(nextZoom) {
  state.plannerZoom = clamp(nextZoom, 0.7, 1.6);
  renderActiveView();
}

function resetPlannerView() {
  state.plannerZoom = 1;
  state.plannerViewCenter = {
    x: state.plannerMapWidth / 2,
    y: 360,
  };
  renderActiveView();
}

function loadSeatingTestGuests() {
  if (state.mode !== "demo") {
    showToast("Test guests are only available in demo mode.", "error");
    return;
  }
  const existingIds = new Set(state.guests.map((guest) => guest.id));
  const nextGuests = seatingTestGuests
    .filter((guest) => !existingIds.has(guest.id))
    .map((guest) => ({
      ...guest,
      inviteLink: buildInviteLink(guest.guestToken),
      qrCodeValue: buildCheckinLink(guest.guestToken),
    }));
  if (!nextGuests.length) {
    showToast("Test guests are already loaded.", "info");
    return;
  }
  state.guests = [...state.guests, ...nextGuests];
  persistDemoDashboardState();
  renderAll();
  showToast("Loaded 12 unassigned seating test guests.", "success");
}

function handlePlannerPointerDown(event) {
  if (event.button !== 0 || state.dragState) return;
  const mobile = window.matchMedia("(max-width: 700px)").matches;
  const mobileEditing = mobile && state.mobileSeatingMode === "edit";
  const mobileExploring = mobile && state.mobileMapOpen;
  if (mobile && !mobileEditing && !mobileExploring) return;
  const viewport = document.getElementById("plannerViewport");
  if (!viewport) return;
  const target = event.target;
  const tableNode = target.closest?.("[data-table-drag-id]");
  const objectNode = target.closest?.("[data-hall-object-id]");
  const seatNode = target.closest?.("[data-action='select-seat']");
  const interactive = target.closest?.("button, input, select, textarea, a, [data-action]");

  if (!tableNode && !objectNode && !interactive) {
    event.preventDefault();
    state.dragState = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenter: { ...state.plannerViewCenter },
      zoom: state.plannerZoom,
      moved: false,
      node: viewport,
    };
    viewport.classList.add("is-panning");
    document.body.classList.add("is-planner-panning");
    try { viewport.setPointerCapture(event.pointerId); } catch {}
    return;
  }

  if ((!tableNode && !objectNode) || seatNode) return;

  if (mobile && !mobileEditing && mobileExploring) return;
  if (mobileEditing && tableNode && tableNode.dataset.tableDragId !== state.selectedTableId) return;
  if (mobileEditing && objectNode && objectNode.dataset.hallObjectId !== state.selectedHallObjectId) return;

  if (objectNode) {
    const objectId = objectNode.dataset.hallObjectId;
    const hallObject = state.hallObjects.find((item) => item.id === objectId);
    if (!hallObject) {
      return;
    }
    state.selectedHallObjectId = objectId;
    state.selectedTableId = "";
    state.activePartyGuestId = "";
    state.seatingPanelTab = "venue";
    if (hallObject.locked || !canManageSeatingLayout()) {
      renderActiveView();
      return;
    }
    state.dragState = {
      type: "hall-object",
      objectId,
      startX: event.clientX,
      startY: event.clientY,
      originalX: Number(hallObject.x || 0),
      originalY: Number(hallObject.y || 0),
      zoom: state.plannerZoom,
      mapWidth: document.getElementById("plannerCanvas")?.clientWidth || state.plannerMapWidth,
      node: objectNode,
      pointerId: event.pointerId,
    };
    try { viewport.setPointerCapture(event.pointerId); } catch {}
    return;
  }

  const tableId = tableNode.dataset.tableDragId;
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }

  state.selectedTableId = tableId;
  state.selectedHallObjectId = "";
  state.activePartyGuestId = "";
  if (!canManageSeatingLayout()) {
    renderActiveView();
    return;
  }
  state.dragState = {
    type: "table",
    tableId,
    startX: event.clientX,
    startY: event.clientY,
    originalX: Number(table.x || 0),
    originalY: Number(table.y || 0),
    zoom: state.plannerZoom,
    mapWidth: document.getElementById("plannerCanvas")?.clientWidth || state.plannerMapWidth,
    node: tableNode,
    pointerId: event.pointerId,
  };
  try { viewport.setPointerCapture(event.pointerId); } catch {}
}

function handlePlannerPointerMove(event) {
  if (!state.dragState) {
    return;
  }

  if (state.dragState.pointerId !== event.pointerId) return;

  if (state.dragState.type === "pan") {
    const dx = event.clientX - state.dragState.startX;
    const dy = event.clientY - state.dragState.startY;
    state.dragState.moved = state.dragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
    state.plannerViewCenter = {
      x: state.dragState.startCenter.x - dx / state.dragState.zoom,
      y: state.dragState.startCenter.y - dy / state.dragState.zoom,
    };
    restorePlannerViewport();
    return;
  }

  const canvas = document.getElementById("plannerCanvas");
  if (!canvas) {
    return;
  }

  const logicalWidth = state.dragState.mapWidth || canvas.clientWidth || 1;
  const logicalHeight = canvas.clientHeight || 1;
  const dx = ((event.clientX - state.dragState.startX) / state.dragState.zoom / logicalWidth) * 100;
  const dy = ((event.clientY - state.dragState.startY) / state.dragState.zoom / logicalHeight) * 100;
  state.dragState.moved =
    state.dragState.moved ||
    Math.abs(event.clientX - state.dragState.startX) > 3 ||
    Math.abs(event.clientY - state.dragState.startY) > 3;
  const isHallObject = state.dragState.type === "hall-object";
  const nextX = clamp(
    state.dragState.originalX + dx,
    isHallObject ? 5 : 8,
    isHallObject ? 95 : 92,
  );
  const nextY = clamp(
    state.dragState.originalY + dy,
    isHallObject ? 5 : 12,
    isHallObject ? 95 : 88,
  );
  if (isHallObject) {
    state.hallObjects = state.hallObjects.map((item) =>
      item.id === state.dragState.objectId
        ? { ...item, x: nextX, y: nextY }
        : item,
    );
  } else {
    state.tables = state.tables.map((table) =>
      table.id === state.dragState.tableId
        ? { ...table, x: nextX, y: nextY }
        : table,
    );
  }
  if (state.dragState.node?.isConnected) {
    state.dragState.node.style.left = `${nextX}%`;
    state.dragState.node.style.top = `${nextY}%`;
  }
}

async function handlePlannerPointerUp(event) {
  if (!state.dragState) {
    return;
  }

  if (event?.pointerId != null && state.dragState.pointerId !== event.pointerId) return;

  const { type, tableId, objectId, moved, originalX, originalY, pointerId, node } =
    state.dragState;
  state.dragState = null;

  if (type === "pan") {
    node?.classList.remove("is-panning");
    document.body.classList.remove("is-planner-panning");
    try { node?.releasePointerCapture(pointerId); } catch {}
    return;
  }
  try { document.getElementById("plannerViewport")?.releasePointerCapture(pointerId); } catch {}

  if (type === "hall-object") {
    const hallObject = state.hallObjects.find((item) => item.id === objectId);
    if (!hallObject) {
      return;
    }
    if (
      !moved ||
      (Math.abs(Number(hallObject.x || 0) - originalX) < 0.01 &&
        Math.abs(Number(hallObject.y || 0) - originalY) < 0.01)
    ) {
      state.selectedHallObjectId = objectId;
      state.selectedTableId = "";
      state.seatingPanelTab = "venue";
      renderActiveView();
      return;
    }
    if (!canManageSeatingLayout()) {
      state.hallObjects = state.hallObjects.map((item) =>
        item.id === objectId ? { ...item, x: originalX, y: originalY } : item,
      );
      renderActiveView();
      showToast("Your role does not allow layout edits.", "error");
      return;
    }
    await persistHallObjects("Venue object position could not be saved.");
    renderActiveView();
    return;
  }

  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }

  if (
    !moved ||
    (Math.abs(Number(table.x || 0) - originalX) < 0.01 &&
      Math.abs(Number(table.y || 0) - originalY) < 0.01)
  ) {
    renderActiveView();
    return;
  }

  if (state.mode === "demo") {
    persistDemoDashboardState();
    renderActiveView();
    return;
  }

  if (!canManageSeatingLayout()) {
    state.tables = state.tables.map((item) =>
      item.id === tableId ? { ...item, x: originalX, y: originalY } : item,
    );
    renderActiveView();
    showToast("Your role does not allow table layout edits.", "error");
    return;
  }

  setSaveState("saving");
  try {
    await updateDoc(
      doc(state.services.db, "weddings", state.weddingId, "tables", tableId),
      {
        x: table.x,
        y: table.y,
        updatedAt: serverTimestamp(),
      },
    );
    setSaveState("saved");
    renderActiveView();
  } catch (error) {
    console.error(error);
    setSaveState("saved");
    renderActiveView();
  }
}

function rememberModalFocus(trigger) {
  if (trigger?.dataset?.tableId && trigger?.dataset?.chairId) {
    state.returnFocusSelector = `[data-action="select-seat"][data-table-id="${CSS.escape(trigger.dataset.tableId)}"][data-chair-id="${CSS.escape(trigger.dataset.chairId)}"]`;
  } else {
    state.returnFocusSelector = "";
  }
}

function restoreModalFocus() {
  if (!state.returnFocusSelector) {
    return;
  }
  document.querySelector(state.returnFocusSelector)?.focus();
  state.returnFocusSelector = "";
}

function openCenteredModal(
  modal,
  renderFn,
  focusSelector = "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
) {
  renderFn?.();
  document.body.classList.add("is-modal-open");
  if (!modal.open) {
    modal.showModal();
  }
  requestAnimationFrame(() => modal.querySelector(focusSelector)?.focus());
}

function handleAssignmentChairClick(tableId, chairId, trigger) {
  if (!can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }
  if (window.matchMedia("(max-width: 700px)").matches && state.mobileSeatingMode === "edit") {
    showToast("Switch to Assign seats to manage people.", "info");
    return;
  }
  const table = state.tables.find((item) => item.id === tableId);
  const chair = table?.chairs.find((item) => item.id === chairId);
  if (!table || !chair) {
    return;
  }
  rememberModalFocus(trigger);
  const assignment = getChairAssignment(tableId, chair);
  if (state.assignmentSession) {
    toggleTemporaryChair(tableId, chairId);
    return;
  }
  if (assignment?.guestId) {
    state.activePartyGuestId = assignment.guestId;
    openCenteredModal(elements.chairDetailsModal, () =>
      renderChairDetailsModal(assignment.guestId),
    );
    renderActiveView();
    return;
  }
  state.guestAssignmentSearch = "";
  state.assignmentSession = {
    mode: "assign",
    guestId: "",
    requiredSeats: 0,
    startingTableId: tableId,
    selectedChairs: [{ tableId, chairId }],
    existingAssignments: [],
    mobileDirectAssignment: window.matchMedia("(max-width: 700px)").matches,
  };
  openCenteredModal(
    elements.assignmentModal,
    renderAssignmentModal,
    "[data-seat-search]",
  );
  renderActiveView();
}

function openMobileTableSeatBrowser(tableId) {
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) return;
  state.selectedTableId = table.id;
  state.selectedHallObjectId = "";
  state.assignmentSession = { mode: "mobile-table", tableId: table.id, mobileDirectAssignment: true };
  openCenteredModal(elements.assignmentModal, renderAssignmentModal, "[data-action='cancel-assignment']");
}

function renderMobileTableSeatBrowser(table) {
  const capacity = Number(table.seatCount || table.capacity || table.chairs?.length || 0);
  const occupied = getTableAssignments(table.id).length;
  return `<div class="da3wa-sheet__header"><div><p class="da3wa-eyebrow">Table · ${occupied}/${capacity} occupied</p><h2>${escapeHtml(table.name || "Table")}</h2></div><button class="da3wa-icon-button" type="button" data-action="cancel-assignment" aria-label="Close table seats">×</button></div><div class="da3wa-sheet__body"><p class="planner-note">Choose a numbered seat to assign or manage the person already seated there.</p><div class="mobile-seat-browser">${[...table.chairs].sort((a,b)=>Number(a.seatNumber)-Number(b.seatNumber)).map((chair)=>{ const assignment=getChairAssignment(table.id,chair); const guest=assignment?.guestId ? state.guests.find((item)=>item.id===assignment.guestId) : null; return `<button type="button" class="mobile-seat-choice ${assignment ? "is-occupied" : "is-empty"}" data-action="mobile-open-seat" data-table-id="${escapeAttribute(table.id)}" data-chair-id="${escapeAttribute(chair.id)}"><strong>Seat ${escapeHtml(String(chair.seatNumber))}</strong><span>${assignment ? escapeHtml(partyMemberLabel(guest, assignment.partyMemberIndex)) : "Available · assign a person"}</span></button>`; }).join("")}</div></div><div class="da3wa-sheet__footer"><button class="da3wa-button da3wa-button--secondary" type="button" data-action="cancel-assignment">Close</button></div>`;
}

function renderAssignmentModal() {
  if (!elements.assignmentContent || !state.assignmentSession) {
    return;
  }
  const session = state.assignmentSession;
  if (session.mode === "mobile-table") {
    const table = state.tables.find((item) => item.id === session.tableId);
    elements.assignmentContent.innerHTML = table ? renderMobileTableSeatBrowser(table) : `<div class="da3wa-sheet__body"><p>This table is no longer available.</p></div>`;
    return;
  }
  const guest = session.guestId
    ? state.guests.find((item) => item.id === session.guestId)
    : null;
  const candidates = getSeatCandidates(session.guestId).filter(
    (item) => getGuestRemainingSeats(item) > 0 || item.id === session.guestId,
  );
  const filtered = candidates.filter((item) => {
    if (session.mobileDirectAssignment && state.mobileAssignmentFilter === "unassigned" && getGuestRemainingSeats(item) <= 0 && item.id !== session.guestId) return false;
    if (!state.guestAssignmentSearch) {
      return true;
    }
    return [item.fullName, item.phone].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(state.guestAssignmentSearch),
    );
  });
  const selectedCount = session.selectedChairs.length;
  elements.assignmentContent.innerHTML = `
    <div class="da3wa-sheet__header">
      <div>
        <p class="da3wa-eyebrow">Assign party</p>
        <h2>${guest ? escapeHtml(guest.fullName) : "Choose a guest"}</h2>
      </div>
      <button class="da3wa-icon-button" type="button" data-action="cancel-assignment" aria-label="Close assignment modal">x</button>
    </div>
    <div class="da3wa-sheet__body">
      ${
        guest
          ? `
        <div class="assignment-progress">
          <strong>${session.mobileDirectAssignment ? "Assign one person to this seat" : `${selectedCount} of ${session.requiredSeats} chairs selected`}</strong>
          <span>${escapeHtml(getSelectedChairSummary(session.selectedChairs))} · ${getPartySize(guest)} people in party · ${getGuestAssignedSeats(guest.id).length} already seated</span>
        </div>
        ${state.modalError ? `<div class="planner-warning-list"><span class="warning-chip">${escapeHtml(state.modalError)}</span></div>` : ""}
        ${session.mobileDirectAssignment ? `<p class="planner-note">This assigns one unseated person from ${escapeHtml(guest.fullName || "this party")} to the selected seat. Remaining party members stay unassigned.</p>` : `<p class="planner-note">Use the canvas behind this modal to add or remove empty chairs. You can save a partial party assignment and finish the remaining seats later.</p>`}
      `
          : `
        ${session.mobileDirectAssignment ? `<div class="mobile-assignment-filters"><button type="button" data-action="mobile-assignment-filter" data-filter="unassigned" class="${state.mobileAssignmentFilter === "unassigned" ? "is-active" : ""}">Needs seats</button><button type="button" data-action="mobile-assignment-filter" data-filter="all" class="${state.mobileAssignmentFilter === "all" ? "is-active" : ""}">All eligible</button></div>` : ""}
        <label class="planner-drawer__search">
          <span>Search by guest name or phone</span>
          <input class="da3wa-input" type="search" value="${escapeAttribute(state.guestAssignmentSearch)}" data-seat-search />
        </label>
        <div class="assignment-guest-list">
          ${filtered.length ? filtered.map(renderAssignmentGuestOption).join("") : `<div class="da3wa-empty">${candidates.length ? "No matching guests need seats." : "All guests are assigned"}</div>`}
        </div>
      `
      }
    </div>
    <div class="da3wa-sheet__footer">
      <button class="da3wa-button da3wa-button--secondary" type="button" data-action="cancel-assignment">Cancel</button>
      <div class="da3wa-sheet__footer-actions">
        ${guest ? actionButton(session.mobileDirectAssignment ? "Assign guest" : "Complete assignment", "complete-assignment", selectedCount < 1 || Boolean(state.activeModalOperation), "primary") : ""}
      </div>
    </div>
  `;
}

function renderAssignmentGuestOption(guest) {
  const assignedCount = getGuestAssignedSeats(guest.id).length;
  const partySize = getPartySize(guest);
  const remaining = Math.max(0, partySize - assignedCount);
  return `
    <button class="assignment-guest-option" type="button" data-action="choose-assignment-guest" data-guest-id="${guest.id}">
      <strong>${escapeHtml(guest.fullName || "Guest")}</strong>
      ${eventUsesGuestSides(state.wedding) ? `<span>${escapeHtml(guest.side || "Side not set")} - party of ${partySize}</span>` : `<span>Party of ${partySize}</span>`}
      <small>${assignedCount} of ${partySize} seats assigned - ${remaining} remaining</small>
    </button>
  `;
}

function chooseGuestForAssignment(guestId) {
  const session = state.assignmentSession;
  const guest = state.guests.find((item) => item.id === guestId);
  if (!session || !guest) {
    return;
  }
  const existingAssignments = getGuestAssignedSeats(guest.id);
  const remainingSeats = Math.max(
    0,
    getPartySize(guest) - existingAssignments.length,
  );
  if (!remainingSeats) {
    showToast("This party is already fully assigned.", "info");
    return;
  }
  session.guestId = guest.id;
  session.requiredSeats = remainingSeats;
  session.existingAssignments = existingAssignments;
  session.selectedChairs = session.selectedChairs.slice(0, remainingSeats);
  state.activePartyGuestId = guest.id;
  if (session.mobileDirectAssignment) {
    session.selectedChairs = session.selectedChairs.slice(0, 1);
    renderAssignmentModal();
    return;
  }
  elements.assignmentModal?.close();
  renderActiveView();
}

function toggleTemporaryChair(tableId, chairId) {
  const session = state.assignmentSession;
  if (!session?.guestId) {
    return;
  }
  const table = state.tables.find((item) => item.id === tableId);
  const chair = table?.chairs.find((item) => item.id === chairId);
  if (!table || !chair) {
    return;
  }
  const existingIndex = session.selectedChairs.findIndex(
    (item) => item.tableId === tableId && item.chairId === chairId,
  );
  if (existingIndex >= 0) {
    session.selectedChairs.splice(existingIndex, 1);
    state.modalError = "";
    renderActiveView();
    return;
  }
  if (getChairAssignment(tableId, chair)) {
    showToast("That chair is already assigned to another party.", "error");
    return;
  }
  if (session.selectedChairs.length >= session.requiredSeats) {
    showToast(
      "This party already has the required number of chairs selected.",
      "error",
    );
    return;
  }
  if (session.selectedChairs.some((item) => item.tableId !== tableId)) {
    // Already split; no extra confirmation needed.
  } else if (session.startingTableId !== tableId) {
    const confirmed = window.confirm(
      "This will split the party across tables. Continue?",
    );
    if (!confirmed) {
      return;
    }
  }
  session.selectedChairs.push({ tableId, chairId });
  state.modalError = "";
  renderActiveView();
}

function isChairTemporarilySelected(tableId, chairId) {
  return Boolean(
    state.assignmentSession?.selectedChairs.some(
      (item) => item.tableId === tableId && item.chairId === chairId,
    ),
  );
}

function getSelectedChairSummary(chairs) {
  return chairs
    .map((item) => {
      const table = state.tables.find((row) => row.id === item.tableId);
      const chair = table?.chairs.find((row) => row.id === item.chairId);
      return `${table?.name || "Table"} chair ${chair?.seatNumber || "?"}`;
    })
    .join(", ");
}

async function completeAssignmentSession() {
  if (state.activeModalOperation || !can("canEditSeating")) {
    return;
  }
  const session = state.assignmentSession;
  const guest = state.guests.find((item) => item.id === session?.guestId);
  if (!session || !guest) {
    return;
  }
  if (session.selectedChairs.length < 1) {
    state.modalError = "Select at least one chair before saving.";
    renderAssignmentWorkflow();
    return;
  }
  state.activeModalOperation = "assignment";
  renderAssignmentWorkflow();
  try {
    const assignedSummary = getSelectedChairSummary(session.selectedChairs);
    await savePartyAssignment(
      guest,
      session.selectedChairs,
      session.mode === "move",
    );
    state.activeModalOperation = "";
    cancelAssignmentSession({ keepModal: true });
    elements.assignmentModal?.close();
    elements.chairDetailsModal?.close();
    renderAll();
    showToast(session.mobileDirectAssignment ? `Person assigned to ${assignedSummary}.` : "Party assignment saved.", "success");
  } catch (error) {
    const diagnosticError = reportSeatingOperationFailure(
      {
        operation: session.mode === "move" ? "move" : "assign",
        stage: "transaction commit",
        tableIds: session.selectedChairs.map((chair) => chair.tableId),
        guestId: guest.id,
      },
      error,
    );
    state.activeModalOperation = "";
    state.modalError = diagnosticError.message;
    renderAssignmentWorkflow();
  }
}

function cancelAssignmentSession({ keepModal = false } = {}) {
  state.assignmentSession = null;
  state.activePartyGuestId = "";
  state.modalError = "";
  if (!keepModal && elements.assignmentModal?.open) {
    elements.assignmentModal.close();
  }
}

function renderAssignmentWorkflow() {
  if (elements.assignmentModal?.open) {
    renderAssignmentModal();
    return;
  }
  renderActiveView();
}

async function savePartyAssignment(guest, selectedChairs, movingParty = false) {
  if (state.mode === "demo") {
    const nextTables = applyPartyAssignmentToTables(
      state.tables,
      guest,
      selectedChairs,
      movingParty,
    );
    const nextGuests = syncGuestSeatingSummaries(state.guests, nextTables);
    state.tables = hydrateTables(nextTables, nextGuests);
    state.guests = nextGuests;
    persistDemoDashboardState();
    renderAll();
    return;
  }

  let savedTables = null;
  let savedGuests = null;
  const tableRefs = await getLiveTableRefs();
  await runTransaction(state.services.db, async (transaction) => {
    const guestSnapshot = await transaction.get(
      doc(state.services.db, "weddings", state.weddingId, "guests", guest.id),
    );
    if (!guestSnapshot.exists()) {
      throw new Error(
        "This guest no longer exists. The seating plan has been refreshed.",
      );
    }
    const liveGuest = {
      ...guest,
      ...guestSnapshot.data(),
      id: guestSnapshot.id,
    };
    const liveTables = await getLiveTablesInTransaction(transaction, tableRefs);
    const liveMirrorSnapshot = await getPublicGuestMirrorInTransaction(
      transaction,
      liveGuest,
    );
    const selectedKeys = new Set(
      selectedChairs.map((item) => buildSeatKey(item.tableId, item.chairId)),
    );
    if (selectedKeys.size !== selectedChairs.length) {
      throw new Error("The same chair cannot be selected twice.");
    }
    const currentPersonIndexes = new Set(
      getGuestAssignedSeats(liveGuest.id, liveTables).map((assignment) =>
        Number(assignment.partyMemberIndex),
      ),
    );
    const availablePartySeats = Math.max(
      0,
      getPartySize(liveGuest) - currentPersonIndexes.size,
    );
    if (movingParty && selectedChairs.length !== getPartySize(liveGuest)) {
      throw new Error(
        "Select one destination chair for every person in this party.",
      );
    }
    if (!movingParty && selectedChairs.length > availablePartySeats) {
      throw new Error(
        "This party no longer has enough unassigned members for the selected chairs.",
      );
    }
    for (const item of selectedChairs) {
      const table = liveTables.find((row) => row.id === item.tableId);
      const chair = table?.chairs.find((row) => row.id === item.chairId);
      if (!table || !chair) {
        throw new Error("One of the selected chairs no longer exists.");
      }
      const assignment = getChairAssignment(table.id, chair);
      if (assignment && assignment.guestId !== liveGuest.id) {
        throw new Error(
          `${table.name} chair ${chair.seatNumber} was assigned in another session.`,
        );
      }
    }
    const nextTables = applyPartyAssignmentToTables(
      liveTables,
      liveGuest,
      selectedChairs,
      movingParty,
    );
    const liveGuests = state.guests.map((item) =>
      item.id === liveGuest.id ? liveGuest : item,
    );
    const nextGuests = syncGuestSeatingSummaries(liveGuests, nextTables);
    savedTables = hydrateTables(nextTables, nextGuests);
    savedGuests = nextGuests;
    // Only write the tables whose chairs were actually changed. Updating the
    // whole floor plan makes a simple seating action needlessly large and can
    // exceed the Firestore rule-evaluation budget for seating-only accounts.
    const changedTableIds = new Set(
      selectedChairs.map((item) => item.tableId),
    );
    if (movingParty) {
      getGuestAssignedSeats(liveGuest.id, liveTables).forEach((assignment) => {
        changedTableIds.add(assignment.tableId);
      });
    }
    nextTables
      .filter((table) => changedTableIds.has(table.id))
      .forEach((table) => {
        transaction.update(
          doc(state.services.db, "weddings", state.weddingId, "tables", table.id),
          {
            chairs: table.chairs,
            guestIds: [
              ...new Set(
                table.chairs
                  .map((chair) => getChairAssignment(table.id, chair)?.guestId)
                  .filter(Boolean),
              ),
            ],
            updatedAt: serverTimestamp(),
          },
        );
      });
    const nextGuest = nextGuests.find((item) => item.id === liveGuest.id);
    transaction.update(
      doc(
        state.services.db,
        "weddings",
        state.weddingId,
        "guests",
        liveGuest.id,
      ),
      buildGuestSeatingPatch(nextGuest),
    );
    updatePublicGuestSeatingMirrorInTransaction(
      transaction,
      liveMirrorSnapshot,
      nextGuest,
    );
  });
  if (savedTables && savedGuests) {
    state.tables = savedTables;
    state.guests = savedGuests;
  }
}

function applyPartyAssignmentToTables(
  tables,
  guest,
  selectedChairs,
  movingParty = false,
) {
  const selectedKeys = new Set(
    selectedChairs.map((item) => buildSeatKey(item.tableId, item.chairId)),
  );
  const existing = getGuestAssignedSeats(guest.id, tables).sort(
    (a, b) => a.partyMemberIndex - b.partyMemberIndex,
  );
  const occupiedPartyIndexes = new Set(
    existing.map((assignment) => Number(assignment.partyMemberIndex)),
  );
  const availablePartyIndexes = Array.from(
    { length: getPartySize(guest) },
    (_, index) => index,
  ).filter((index) => movingParty || !occupiedPartyIndexes.has(index));
  return tables.map((table) => ({
    ...table,
    chairs: table.chairs.map((chair) => {
      const key = buildSeatKey(table.id, chair.id);
      const selectedIndex = selectedChairs.findIndex(
        (item) => buildSeatKey(item.tableId, item.chairId) === key,
      );
      const currentAssignment = getChairAssignment(table.id, chair);
      if (
        (movingParty || selectedKeys.has(key)) &&
        currentAssignment?.guestId === guest.id &&
        selectedIndex < 0
      ) {
        return { ...chair, guestId: "", assignment: null, status: "available" };
      }
      if (selectedIndex >= 0) {
        const partyMemberIndex = availablePartyIndexes[selectedIndex];
        return {
          ...chair,
          guestId: guest.id,
          status: "assigned",
          assignment: {
            tableId: table.id,
            tableName: table.name,
            seatNumber: Number(chair.seatNumber),
            guestId: guest.id,
            partyMemberIndex,
            personKey: personKeyForIndex(partyMemberIndex),
            label: partyLabelForIndex(partyMemberIndex),
            isMainGuest: partyMemberIndex === 0,
          },
        };
      }
      return chair;
    }),
  }));
}

function syncGuestSeatingSummaries(guests, tables) {
  return guests.map((guest) => ({
    ...guest,
    ...buildGuestSeatingPatchFromTables(guest, tables, false),
  }));
}

function buildGuestSeatingPatch(guest) {
  return {
    seatingAssignments: guest.seatingAssignments || [],
    tableId: guest.tableId || "",
    tableName: guest.tableName || "",
    seatNumber: guest.seatNumber || "",
    updatedAt: serverTimestamp(),
  };
}

// Firestore returns one error for a rejected transaction, even when a
// transaction contains several reads and writes. Keep the browser-console
// diagnostic explicit enough to identify the operation and its document
// scope, while never logging the invitation token used as a publicGuest id.
function reportSeatingOperationFailure({ operation, stage, tableIds = [], guestId = "" }, error) {
  const weddingPath = `weddings/${state.weddingId || "{missing-wedding-id}"}`;
  const paths = [
    ...[...new Set(tableIds.filter(Boolean))].map(
      (tableId) => `${weddingPath}/tables/${tableId}`,
    ),
    ...(guestId ? [`${weddingPath}/guests/${guestId}`] : []),
    ...(guestId ? [`${weddingPath}/publicGuests/{invitation-token-for-${guestId}}`] : []),
  ];
  const diagnostic = {
    operation,
    stage,
    weddingId: state.weddingId || "",
    paths,
    firebaseCode: error?.code || "unknown",
  };
  console.error("Seating Firestore operation failed.", diagnostic, error);
  const code = diagnostic.firebaseCode === "unknown" ? "" : ` (${diagnostic.firebaseCode})`;
  return new Error(
    `Seating ${operation} failed during ${stage}${code}. Check the browser console for the affected document paths.`,
  );
}

function buildGuestSeatingPatchFromTables(
  guest,
  tables,
  includeTimestamp = true,
) {
  const seenPersonKeys = new Set();
  const assignments = getGuestAssignedSeats(guest.id, tables)
    .sort((a, b) => a.partyMemberIndex - b.partyMemberIndex)
    .filter((assignment) => {
      const key =
        assignment.personKey || personKeyForIndex(assignment.partyMemberIndex);
      if (seenPersonKeys.has(key)) {
        return false;
      }
      seenPersonKeys.add(key);
      return true;
    });
  const primary =
    assignments.find((assignment) => assignment.partyMemberIndex === 0) ||
    assignments[0];
  const patch = {
    seatingAssignments: assignments.map((assignment) => ({
      tableId: assignment.tableId,
      tableName:
        assignment.tableName ||
        tables.find((table) => table.id === assignment.tableId)?.name ||
        "",
      seatNumber: Number(assignment.seatNumber),
      guestId: assignment.guestId,
      partyMemberIndex: Number(assignment.partyMemberIndex),
      personKey:
        assignment.personKey || personKeyForIndex(assignment.partyMemberIndex),
      label:
        assignment.label || partyLabelForIndex(assignment.partyMemberIndex),
      isMainGuest: assignment.partyMemberIndex === 0,
    })),
    tableId: primary?.tableId || "",
    tableName: primary?.tableName || "",
    seatNumber: primary ? String(primary.seatNumber) : "",
  };
  if (includeTimestamp) {
    patch.updatedAt = serverTimestamp();
  }
  return patch;
}

function renderChairDetailsModal(guestId) {
  const guest = state.guests.find((item) => item.id === guestId);
  if (!elements.chairDetailsContent || !guest) {
    return;
  }
  const assignments = getGuestAssignedSeats(guestId).sort(
    (a, b) => a.partyMemberIndex - b.partyMemberIndex,
  );
  elements.chairDetailsContent.innerHTML = `
    <div class="da3wa-sheet__header">
      <div>
        <p class="da3wa-eyebrow">Chair details</p>
        <h2>${escapeHtml(guest.fullName || "Guest")}</h2>
      </div>
      <button class="da3wa-icon-button" type="button" data-close-modal="chairDetailsModal" aria-label="Close chair details">x</button>
    </div>
    <div class="da3wa-sheet__body">
      <div class="assignment-progress">
        <strong>Party size ${getPartySize(guest)}</strong>
        <span>${assignments.length} of ${getPartySize(guest)} seats assigned</span>
      </div>
      <div class="chair-detail-list">
        ${assignments
          .map(
            (assignment) => `
          <div class="chair-detail-row">
            <strong>${escapeHtml(partyMemberLabel(guest, assignment.partyMemberIndex))}</strong>
            <span>${escapeHtml(assignment.tableName || assignment.tableId)} - Chair ${escapeHtml(String(assignment.seatNumber))}${assignment.partyMemberIndex === 0 ? " - Main guest chair" : ""}</span>
            <button class="guest-quick-button" type="button" data-action="unassign-seat" data-table-id="${escapeAttribute(assignment.tableId)}" data-chair-id="${escapeAttribute(assignment.chairId)}" ${state.activeModalOperation ? 'disabled aria-disabled="true"' : ""}>Unassign this seat</button>
          </div>
        `,
          )
          .join("")}
      </div>
      ${state.modalError ? `<div class="planner-warning-list"><span class="warning-chip">${escapeHtml(state.modalError)}</span></div>` : ""}
    </div>
    <div class="da3wa-sheet__footer">
      <button class="da3wa-button da3wa-button--secondary" type="button" data-close-modal="chairDetailsModal">Close</button>
      <div class="da3wa-sheet__footer-actions">
        ${actionButton("Move party", "move-party", Boolean(state.activeModalOperation), "secondary", guest.id)}
        ${actionButton("Unassign entire party", "unassign-party", Boolean(state.activeModalOperation), "danger", guest.id)}
      </div>
    </div>
  `;
}

function renderMovePartyModal(guestId) {
  const guest = state.guests.find((item) => item.id === guestId);
  if (!elements.chairDetailsContent || !guest) {
    return;
  }
  const partySize = getPartySize(guest);
  const currentAssignments = getGuestAssignedSeats(guestId).sort(
    (a, b) => a.partyMemberIndex - b.partyMemberIndex,
  );
  const currentTables = [
    ...new Set(
      currentAssignments
        .map((assignment) => assignment.tableName || assignment.tableId)
        .filter(Boolean),
    ),
  ];
  const tablesWithoutParty = clearGuestFromTables(state.tables, guestId);
  elements.chairDetailsContent.innerHTML = `
    <div class="da3wa-sheet__header">
      <div>
        <p class="da3wa-eyebrow">Move party</p>
        <h2>${escapeHtml(guest.fullName || "Guest")}</h2>
      </div>
      <button class="da3wa-icon-button" type="button" data-close-modal="chairDetailsModal" aria-label="Close move party">x</button>
    </div>
    <div class="da3wa-sheet__body">
      <div class="assignment-progress">
        <strong>Party size ${partySize}</strong>
        <span>Current table: ${escapeHtml(currentTables.join(", ") || "Not assigned")}</span>
      </div>
      <p class="planner-note">Choose one destination table with enough available chairs. The move keeps the party together and only saves after every chair is confirmed available.</p>
      ${state.modalError ? `<div class="planner-warning-list"><span class="warning-chip">${escapeHtml(state.modalError)}</span></div>` : ""}
      <div class="chair-detail-list">
        ${tablesWithoutParty
          .map((table) => {
            const available = getAvailableChairs(table).length;
            const disabled =
              available < partySize || Boolean(state.activeModalOperation);
            return `
            <button class="assignment-guest-option ${disabled ? "is-disabled" : ""}" type="button" data-action="move-party-destination" data-guest-id="${escapeAttribute(guest.id)}" data-table-id="${escapeAttribute(table.id)}" ${disabled ? 'disabled aria-disabled="true"' : ""}>
              <strong>${escapeHtml(table.name || "Table")}</strong>
              <span>${available} available chair${available === 1 ? "" : "s"} - needs ${partySize}</span>
              <small>${available < partySize ? "Not enough free chairs for this party" : "Ready to move the full party here"}</small>
            </button>
          `;
          })
          .join("")}
      </div>
    </div>
    <div class="da3wa-sheet__footer">
      <button class="da3wa-button da3wa-button--secondary" type="button" data-close-modal="chairDetailsModal" ${state.activeModalOperation ? 'disabled aria-disabled="true"' : ""}>Cancel</button>
    </div>
  `;
}

function beginMoveParty(guestId) {
  const guest = state.guests.find((item) => item.id === guestId);
  if (!guest) {
    return;
  }
  state.activePartyGuestId = guestId;
  renderMovePartyModal(guestId);
  openCenteredModal(elements.chairDetailsModal);
  renderActiveView();
}

async function unassignParty(guestId) {
  if (state.activeModalOperation || !can("canEditSeating")) {
    return;
  }
  const party = resolvePartyForGuestId(guestId);
  if (!party) {
    return;
  }
  state.pendingPartyUnassignId = party.partyGuestId;
  state.pendingPartyUnassignSignature = partyAssignmentSignature(party);
  renderPartyUnassignConfirmation(party);
}

function renderPartyUnassignConfirmation(party) {
  if (!elements.chairDetailsContent || !party) {
    return;
  }
  elements.chairDetailsContent.innerHTML = `
    <div class="da3wa-sheet__header">
      <div>
        <p class="da3wa-eyebrow">Unassign entire party</p>
        <h2>${escapeHtml(party.guest.fullName || "Guest")}</h2>
      </div>
      <button class="da3wa-icon-button" type="button" data-close-modal="chairDetailsModal" aria-label="Close unassign confirmation">x</button>
    </div>
    <div class="da3wa-sheet__body">
      <div class="delete-summary-grid">
        ${plannerStat("Party size", String(party.partySize))}
        ${plannerStat("Currently assigned", `${party.assignments.length} of ${party.partySize}`)}
        ${plannerStat("Tables affected", party.affectedTables.join(", ") || "None")}
      </div>
      <div class="planner-warning-list"><span class="warning-chip">Every assigned member of this party will be removed from their chair. Guest records and party size will remain unchanged.</span></div>
      ${state.modalError ? `<div class="planner-warning-list"><span class="warning-chip">${escapeHtml(state.modalError)}</span></div>` : ""}
    </div>
    <div class="da3wa-sheet__footer">
      <button class="da3wa-button da3wa-button--secondary" type="button" data-action="cancel-unassign-party" data-guest-id="${escapeAttribute(party.partyGuestId)}" ${state.activeModalOperation ? "disabled" : ""}>Cancel</button>
      <button class="da3wa-button da3wa-button--danger" type="button" data-action="confirm-unassign-party" data-guest-id="${escapeAttribute(party.partyGuestId)}" ${state.activeModalOperation ? 'disabled aria-disabled="true"' : ""}>${state.activeModalOperation ? "Unassigning..." : "Unassign entire party"}</button>
    </div>
  `;
}

async function confirmPartyUnassign(guestId) {
  if (
    state.activeModalOperation ||
    !guestId ||
    String(state.pendingPartyUnassignId) !== String(guestId) ||
    !can("canEditSeating")
  )
    return;
  const party = resolvePartyForGuestId(guestId);
  if (!party) return;
  state.activeModalOperation = "unassign";
  state.modalError = "";
  renderPartyUnassignConfirmation(party);
  try {
    await clearPartyAssignments(
      party.partyGuestId,
      state.pendingPartyUnassignSignature,
    );
    state.activeModalOperation = "";
    state.activePartyGuestId = "";
    state.pendingPartyUnassignId = "";
    state.pendingPartyUnassignSignature = "";
    elements.chairDetailsModal?.close();
    showToast("The entire party has been unassigned.", "success");
  } catch (error) {
    const diagnosticError = reportSeatingOperationFailure(
      {
        operation: "unassign-party",
        stage: "transaction commit",
        tableIds: party.assignments.map((assignment) => assignment.tableId),
        guestId,
      },
      error,
    );
    state.activeModalOperation = "";
    state.modalError =
      diagnosticError.message ||
      "The party could not be unassigned. The seating plan has been refreshed.";
    const refreshedParty = resolvePartyForGuestId(guestId) || party;
    state.pendingPartyUnassignSignature =
      partyAssignmentSignature(refreshedParty);
    renderPartyUnassignConfirmation(refreshedParty);
  }
}

async function clearPartyAssignments(guestId, expectedSignature = "") {
  if (state.mode === "demo") {
    const nextTables = clearGuestFromTables(state.tables, guestId);
    const nextGuests = syncGuestSeatingSummaries(state.guests, nextTables);
    state.tables = hydrateTables(nextTables, nextGuests);
    state.guests = nextGuests;
    persistDemoDashboardState();
    renderAll();
    return;
  }
  let nextTables = [];
  let nextGuests = [];
  const tableRefs = await getLiveTableRefs();
  await runTransaction(state.services.db, async (transaction) => {
    const liveTables = await getLiveTablesInTransaction(transaction, tableRefs);
    const liveParty = resolvePartyForGuestId(guestId, liveTables);
    if (!liveParty)
      throw new Error(
        "This party no longer exists. The seating plan has been refreshed.",
      );
    if (
      expectedSignature &&
      partyAssignmentSignature(liveParty) !== expectedSignature
    ) {
      throw new Error(
        "This party changed on another device. Review the refreshed seating plan and confirm again.",
      );
    }
    nextTables = clearGuestFromTables(liveTables, guestId);
    const guestSnapshot = await transaction.get(
      doc(state.services.db, "weddings", state.weddingId, "guests", guestId),
    );
    if (!guestSnapshot.exists())
      throw new Error(
        "This party no longer exists. The seating plan has been refreshed.",
      );
    const liveGuest = { ...guestSnapshot.data(), id: guestSnapshot.id };
    const liveMirrorSnapshot = await getPublicGuestMirrorInTransaction(
      transaction,
      liveGuest,
    );
    nextGuests = state.guests.map((guest) =>
      guest.id === guestId
        ? {
            ...guest,
            ...liveGuest,
            ...buildGuestSeatingPatchFromTables(liveGuest, nextTables, false),
          }
        : guest,
    );
    // A full-party clear affects only the tables with one of its assigned
    // chairs. Avoid rewriting untouched tables in this atomic transaction.
    const affectedTableIds = new Set(
      liveParty.assignments.map((assignment) => assignment.tableId),
    );
    nextTables
      .filter((table) => affectedTableIds.has(table.id))
      .forEach((table) => {
      transaction.update(
        doc(state.services.db, "weddings", state.weddingId, "tables", table.id),
        {
          chairs: table.chairs,
          guestIds: [
            ...new Set(
              table.chairs
                .map((chair) => getChairAssignment(table.id, chair)?.guestId)
                .filter(Boolean),
            ),
          ],
          updatedAt: serverTimestamp(),
        },
      );
      });
    transaction.update(
      guestSnapshot.ref,
      buildGuestSeatingPatch(nextGuests.find((guest) => guest.id === guestId)),
    );
    updatePublicGuestSeatingMirrorInTransaction(
      transaction,
      liveMirrorSnapshot,
      nextGuests.find((guest) => guest.id === guestId),
    );
  });
  state.tables = hydrateTables(nextTables, nextGuests);
  state.guests = nextGuests;
  state.selectedSeatId = "";
  renderAll();
}

async function confirmUnassignSeat(tableId, chairId) {
  if (state.activeModalOperation || !can("canEditSeating")) {
    return;
  }
  const seat = getSeatByIds(tableId, chairId);
  const assignment = seat?.chair
    ? getChairAssignment(tableId, seat.chair)
    : null;
  const guest = assignment?.guestId
    ? state.guests.find((item) => item.id === assignment.guestId)
    : null;
  if (!seat || !assignment || !guest) {
    showToast("That chair is already empty.", "info");
    return;
  }
  const personLabel =
    assignment.label || partyMemberLabel(guest, assignment.partyMemberIndex);
  const confirmed = window.confirm(
    `Unassign ${personLabel} from ${seat.table.name} chair ${seat.chair.seatNumber}?`,
  );
  if (!confirmed) {
    return;
  }
  state.activeModalOperation = "unassign-seat";
  renderChairDetailsModal(guest.id);
  try {
    await unassignSingleSeat(tableId, chairId);
    state.activeModalOperation = "";
    elements.chairDetailsModal?.close();
    showToast("Seat unassigned.", "success");
  } catch (error) {
    const diagnosticError = reportSeatingOperationFailure(
      {
        operation: "unassign-seat",
        stage: "transaction commit",
        tableIds: [tableId],
        guestId: guest.id,
      },
      error,
    );
    state.activeModalOperation = "";
    state.modalError = diagnosticError.message;
    renderChairDetailsModal(guest.id);
  }
}

async function unassignSingleSeat(tableId, chairId) {
  const localSeat = getSeatByIds(tableId, chairId);
  const localAssignment = localSeat?.chair
    ? getChairAssignment(tableId, localSeat.chair)
    : null;
  const guestId = localAssignment?.guestId || "";
  if (!guestId) {
    return;
  }

  if (state.mode === "demo") {
    const nextTables = clearSeatFromTables(state.tables, tableId, chairId);
    const nextGuests = syncGuestSeatingSummaries(state.guests, nextTables);
    state.tables = hydrateTables(nextTables, nextGuests);
    state.guests = nextGuests;
    state.selectedSeatId = "";
    persistDemoDashboardState();
    renderAll();
    return;
  }

  let savedTables = null;
  let savedGuests = null;
  const tableRefs = await getLiveTableRefs();
  await runTransaction(state.services.db, async (transaction) => {
    const liveTables = await getLiveTablesInTransaction(transaction, tableRefs);
    const liveSeat = getSeatByIds(tableId, chairId, liveTables);
    const liveAssignment = liveSeat?.chair
      ? getChairAssignment(tableId, liveSeat.chair)
      : null;
    if (!liveSeat) {
      throw new Error("The selected chair no longer exists.");
    }
    if (!liveAssignment || liveAssignment.guestId !== guestId) {
      throw new Error("The selected chair has changed. Refresh and try again.");
    }
    const nextTables = clearSeatFromTables(liveTables, tableId, chairId);
    const guestSnapshot = await transaction.get(
      doc(state.services.db, "weddings", state.weddingId, "guests", guestId),
    );
    if (!guestSnapshot.exists()) {
      throw new Error(
        "The guest no longer exists. The seating plan has been refreshed.",
      );
    }
    const liveGuest = { ...guestSnapshot.data(), id: guestSnapshot.id };
    const liveMirrorSnapshot = await getPublicGuestMirrorInTransaction(
      transaction,
      liveGuest,
    );
    const liveGuests = state.guests.map((guest) =>
      guest.id === liveGuest.id ? { ...guest, ...liveGuest } : guest,
    );
    const nextGuests = syncGuestSeatingSummaries(liveGuests, nextTables);
    savedTables = hydrateTables(nextTables, nextGuests);
    savedGuests = nextGuests;
    const nextTable = nextTables.find((table) => table.id === tableId);
    transaction.update(
      doc(state.services.db, "weddings", state.weddingId, "tables", tableId),
      {
        chairs: nextTable.chairs,
        guestIds: [
          ...new Set(
            nextTable.chairs
              .map((chair) => getChairAssignment(tableId, chair)?.guestId)
              .filter(Boolean),
          ),
        ],
        updatedAt: serverTimestamp(),
      },
    );
    const nextGuest = nextGuests.find((guest) => guest.id === guestId);
    transaction.update(
      doc(state.services.db, "weddings", state.weddingId, "guests", guestId),
      buildGuestSeatingPatch(nextGuest),
    );
    updatePublicGuestSeatingMirrorInTransaction(
      transaction,
      liveMirrorSnapshot,
      nextGuest,
    );
  });
  if (savedTables && savedGuests) {
    state.tables = savedTables;
    state.guests = savedGuests;
    state.selectedSeatId = "";
    renderAll();
  }
}

function clearGuestFromTables(tables, guestId) {
  return tables.map((table) => ({
    ...table,
    chairs: table.chairs.map((chair) => {
      const assignment = getChairAssignment(table.id, chair);
      if (assignment?.guestId !== guestId) {
        return chair;
      }
      return { ...chair, guestId: "", assignment: null, status: "available" };
    }),
  }));
}

function clearSeatFromTables(tables, tableId, chairId) {
  return tables.map((table) => ({
    ...table,
    chairs: table.chairs.map((chair) => {
      if (table.id !== tableId || chair.id !== chairId) {
        return chair;
      }
      return { ...chair, guestId: "", assignment: null, status: "available" };
    }),
  }));
}

function getAvailableChairs(table) {
  return (table?.chairs || []).filter(
    (chair) => !getChairAssignment(table.id, chair),
  );
}

function getSeatByIds(tableId, chairId, tables = state.tables) {
  const table = tables.find((item) => item.id === tableId);
  const chair = table?.chairs.find((item) => item.id === chairId);
  return table && chair ? { table, chair } : null;
}

async function confirmMovePartyToTable(guestId, tableId) {
  if (state.activeModalOperation || !can("canEditSeating")) {
    return;
  }
  const guest = state.guests.find((item) => item.id === guestId);
  const destination = state.tables.find((item) => item.id === tableId);
  if (!guest || !destination) {
    return;
  }
  const partySize = getPartySize(guest);
  const currentTables = [
    ...new Set(
      getGuestAssignedSeats(guestId)
        .map((assignment) => assignment.tableName || assignment.tableId)
        .filter(Boolean),
    ),
  ];
  const available = getAvailableChairs(
    clearGuestFromTables(state.tables, guestId).find(
      (table) => table.id === tableId,
    ),
  ).length;
  const confirmed = window.confirm(
    `Move party of ${partySize} from ${currentTables.join(", ") || "unassigned"} to ${destination.name}? ${available} chair${available === 1 ? "" : "s"} available.`,
  );
  if (!confirmed) {
    return;
  }
  state.activeModalOperation = "move-party";
  renderMovePartyModal(guestId);
  try {
    await movePartyToTable(guestId, tableId);
    state.activeModalOperation = "";
    elements.chairDetailsModal?.close();
    showToast("Party moved.", "success");
  } catch (error) {
    const diagnosticError = reportSeatingOperationFailure(
      {
        operation: "move-party",
        stage: "transaction commit",
        tableIds: [
          tableId,
          ...getGuestAssignedSeats(guestId).map((assignment) => assignment.tableId),
        ],
        guestId,
      },
      error,
    );
    state.activeModalOperation = "";
    state.modalError = diagnosticError.message;
    renderMovePartyModal(guestId);
  }
}

async function movePartyToTable(guestId, destinationTableId) {
  const guest = state.guests.find((item) => item.id === guestId);
  if (!guest) {
    throw new Error("Guest not found.");
  }
  const buildMovedTables = (tables, partyGuest) => {
    const partySize = getPartySize(partyGuest);
    const clearedTables = clearGuestFromTables(tables, guestId);
    const destination = clearedTables.find(
      (table) => table.id === destinationTableId,
    );
    if (!destination) {
      throw new Error("Destination table no longer exists.");
    }
    const availableChairs = getAvailableChairs(destination);
    if (availableChairs.length < partySize) {
      throw new Error(
        `${destination.name} only has ${availableChairs.length} available chair${availableChairs.length === 1 ? "" : "s"} for a party of ${partySize}.`,
      );
    }
    const selectedChairs = availableChairs
      .slice(0, partySize)
      .map((chair) => ({ tableId: destination.id, chairId: chair.id }));
    return applyPartyAssignmentToTables(
      clearedTables,
      partyGuest,
      selectedChairs,
      true,
    );
  };

  if (state.mode === "demo") {
    const nextTables = buildMovedTables(state.tables, guest);
    const nextGuests = syncGuestSeatingSummaries(state.guests, nextTables);
    state.tables = hydrateTables(nextTables, nextGuests);
    state.guests = nextGuests;
    state.selectedTableId = destinationTableId;
    state.selectedSeatId = "";
    persistDemoDashboardState();
    renderAll();
    return;
  }

  let savedTables = null;
  let savedGuests = null;
  const tableRefs = await getLiveTableRefs();
  await runTransaction(state.services.db, async (transaction) => {
    const guestSnapshot = await transaction.get(
      doc(state.services.db, "weddings", state.weddingId, "guests", guestId),
    );
    if (!guestSnapshot.exists()) {
      throw new Error(
        "This party no longer exists. The seating plan has been refreshed.",
      );
    }
    const liveGuest = {
      ...guest,
      ...guestSnapshot.data(),
      id: guestSnapshot.id,
    };
    const liveTables = await getLiveTablesInTransaction(transaction, tableRefs);
    const liveMirrorSnapshot = await getPublicGuestMirrorInTransaction(
      transaction,
      liveGuest,
    );
    const nextTables = buildMovedTables(liveTables, liveGuest);
    const liveGuests = state.guests.map((item) =>
      item.id === liveGuest.id ? liveGuest : item,
    );
    const nextGuests = syncGuestSeatingSummaries(liveGuests, nextTables);
    savedTables = hydrateTables(nextTables, nextGuests);
    savedGuests = nextGuests;
    const affectedTableIds = new Set([
      destinationTableId,
      ...getGuestAssignedSeats(liveGuest.id, liveTables).map(
        (assignment) => assignment.tableId,
      ),
    ]);
    nextTables
      .filter((table) => affectedTableIds.has(table.id))
      .forEach((table) => {
        transaction.update(
          doc(
            state.services.db,
            "weddings",
            state.weddingId,
            "tables",
            table.id,
          ),
          {
            chairs: table.chairs,
            guestIds: [
              ...new Set(
                table.chairs
                  .map((chair) => getChairAssignment(table.id, chair)?.guestId)
                  .filter(Boolean),
              ),
            ],
            updatedAt: serverTimestamp(),
          },
        );
      });
    const nextGuest = nextGuests.find((item) => item.id === liveGuest.id);
    transaction.update(
      doc(
        state.services.db,
        "weddings",
        state.weddingId,
        "guests",
        liveGuest.id,
      ),
      buildGuestSeatingPatch(nextGuest),
    );
    updatePublicGuestSeatingMirrorInTransaction(
      transaction,
      liveMirrorSnapshot,
      nextGuest,
    );
  });
  if (savedTables && savedGuests) {
    state.tables = savedTables;
    state.guests = savedGuests;
    state.selectedTableId = destinationTableId;
    state.selectedSeatId = "";
    renderAll();
  }
}

async function assignGuestToChair(tableId, chairId, guestId) {
  if (state.activeModalOperation || !can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  const table = state.tables.find((item) => item.id === tableId);
  const targetChair = table?.chairs.find((chair) => chair.id === chairId);
  const guest = guestId
    ? state.guests.find((item) => item.id === guestId)
    : null;
  if (!table || !targetChair || !guest) {
    showToast(
      "That guest or chair is no longer available. The seating plan has been refreshed.",
      "error",
    );
    return;
  }

  const targetAssignment = getChairAssignment(table.id, targetChair);
  if (targetAssignment?.guestId === guest.id) {
    showToast("This party member is already assigned to this chair.", "info");
    return;
  }

  if (targetAssignment?.guestId) {
    showToast(
      "This chair is assigned to another guest. Clear it before assigning someone else.",
      "error",
    );
    return;
  }

  if (getGuestRemainingSeats(guest) < 1) {
    showToast("Every person in this party already has a chair.", "info");
    return;
  }

  if (guest?.rsvpStatus === "declined") {
    showToast(
      "Declined guest assignment noted. Review before finalizing the floor plan.",
      "info",
    );
  }
  if (guest?.rsvpStatus === "pending") {
    showToast(
      "Pending RSVP guest seated. Consider confirming attendance.",
      "info",
    );
  }

  state.activeModalOperation = "assign-seat";
  setSaveState("saving");
  renderActiveView();
  try {
    await savePartyAssignment(guest, [{ tableId, chairId }], false);
    state.activeModalOperation = "";
    setSaveState("saved");
    state.selectedTableId = tableId;
    state.selectedSeatId = buildSeatKey(tableId, chairId);
    renderAll();
    showToast("Guest assigned to seat.", "success");
  } catch (error) {
    const diagnosticError = reportSeatingOperationFailure(
      {
        operation: "assign-seat",
        stage: "transaction commit",
        tableIds: [tableId],
        guestId: guest.id,
      },
      error,
    );
    state.activeModalOperation = "";
    setSaveState("saved");
    renderAll();
    showToast(
      diagnosticError.message ||
        "This chair was assigned by another editor. The seating plan has been refreshed.",
      "error",
    );
  }
}

async function syncTablesAndGuests() {
  if (state.mode === "demo") {
    state.tables = hydrateTables(state.tables);
    renderAll();
    return;
  }

  if (!state.tables.length || !can("canEditSeating")) {
    return;
  }

  const nextTables = hydrateTables(state.tables.map((table) => ({ ...table })));
  const batch = writeBatch(state.services.db);
  nextTables.forEach((table) => {
    batch.update(
      doc(state.services.db, "weddings", state.weddingId, "tables", table.id),
      {
        chairs: table.chairs,
        guestIds: [
          ...new Set(
            table.chairs
              .map((chair) => getChairAssignment(table.id, chair)?.guestId)
              .filter(Boolean),
          ),
        ],
        updatedAt: serverTimestamp(),
      },
    );
  });
  await batch.commit();
}

async function handleExport(type) {
  if (!eventUsesGuestSides(state.wedding) && ["bride", "groom"].includes(type)) type = "all";
  const filtered = (() => {
    switch (type) {
      case "confirmed":
        return state.guests.filter((guest) => guest.rsvpStatus === "confirmed");
      case "pending":
        return state.guests.filter((guest) => guest.rsvpStatus === "pending");
      case "declined":
        return state.guests.filter((guest) => guest.rsvpStatus === "declined");
      case "checkedIn":
        return state.guests.filter((guest) => guest.checkedIn);
      case "notCheckedIn":
        return state.guests.filter((guest) => !guest.checkedIn);
      case "tables":
        return [...state.guests].sort((a, b) =>
          String(a.tableName || "").localeCompare(String(b.tableName || "")),
        );
      case "bride":
        return state.guests.filter((guest) => guest.side === "bride");
      case "groom":
        return state.guests.filter((guest) => guest.side === "groom");
      case "selected":
        return state.guests.filter((guest) =>
          state.selectedGuestIds.includes(guest.id),
        );
      case "all":
      default:
        return state.guests;
    }
  })();

  const format = await exportGuests(
    filtered.map((guest) => ({
      ...guest,
      checkedInAt: formatTimestamp(guest.checkedInAt),
    })),
    `guests-${type || "all"}`,
    { includeSeating: type === "tables", includeSide: eventUsesGuestSides(state.wedding) },
  );
  showToast(`Guest export completed as ${format.toUpperCase()}.`, "success");
}

function hydrateTables(tables, guests = state.guests) {
  return tables.map((table) => {
    const next = createPlannerTable(table);
    next.chairs = next.chairs.map((chair) => {
      const storedChair = (table.chairs || []).find(
        (item) =>
          item.id === chair.id ||
          Number(item.seatNumber) === Number(chair.seatNumber),
      );
      const hasExplicitStoredState = Boolean(
        storedChair &&
          (Object.prototype.hasOwnProperty.call(storedChair, "assignment") ||
            Object.prototype.hasOwnProperty.call(storedChair, "guestId") ||
            Object.prototype.hasOwnProperty.call(storedChair, "status")),
      );
      // Tables are the authoritative chair source. Guest assignment mirrors
      // are used only for pre-chair legacy table documents; otherwise a stale
      // guest listener can incorrectly put a just-cleared person back in a chair.
      const matchingGuestAssignment = hasExplicitStoredState
        ? null
        : findGuestAssignmentForChair(next, chair, guests);
      const assignment =
        normalizeAssignment(chair.assignment, next.id, chair) ||
        matchingGuestAssignment;
      return {
        ...chair,
        guestId: assignment?.guestId || "",
        assignment,
        status: assignment ? "assigned" : chair.status || "available",
      };
    });
    return next;
  });
}

function findGuestAssignmentForChair(table, chair, guests = state.guests) {
  for (const guest of guests) {
    const structuredAssignments = Array.isArray(guest.seatingAssignments)
      ? guest.seatingAssignments
      : [];
    const match = structuredAssignments.find(
      (assignment) =>
        assignment.tableId === table.id &&
        String(assignment.seatNumber || "") === String(chair.seatNumber),
    );
    if (match) {
      return normalizeAssignment(
        {
          ...match,
          guestId: guest.id,
          tableName: match.tableName || table.name,
        },
        table.id,
        chair,
      );
    }
    if (
      !structuredAssignments.length &&
      guest.tableId === table.id &&
      String(guest.seatNumber || "") === String(chair.seatNumber)
    ) {
      return normalizeAssignment(
        {
          tableId: table.id,
          tableName: table.name,
          seatNumber: Number(chair.seatNumber),
          guestId: guest.id,
          partyMemberIndex: 0,
          personKey: "main",
          label: "Main Guest",
          isMainGuest: true,
        },
        table.id,
        chair,
      );
    }
  }
  return null;
}

function createPlannerTable(table) {
  const tableId = table.id || createId("table");
  const seatCount = Number(table.seatCount || table.capacity || 8);
  const width = Number(table.width || defaultWidthForShape(table.shape));
  const height = Number(table.height || defaultHeightForShape(table.shape));
  const chairs = generateChairs(
    table.shape || "round",
    seatCount,
    width,
    height,
    table.chairs || [],
    tableId,
  );

  return {
    id: tableId,
    name: resolveTableName(table, "New Table"),
    capacity: seatCount,
    seatCount,
    shape: table.shape || "round",
    floorZone: table.floorZone || "Grand Hall",
    x: Number(table.x ?? 20),
    y: Number(table.y ?? 20),
    width,
    height,
    rotation: Number(table.rotation || 0),
    tableColor: table.tableColor || plannerPalette.tableColor,
    borderColor: table.borderColor || plannerPalette.borderColor,
    chairColor: table.chairColor || plannerPalette.chairColor,
    chairs,
    guestIds: table.guestIds || [],
    locked: Boolean(table.locked),
  };
}

function generateChairs(
  shape,
  seatCount,
  width,
  height,
  previousChairs,
  tableId = "table",
) {
  const existing = Array.isArray(previousChairs) ? previousChairs : [];
  const positions = buildChairPositions(shape, seatCount, width, height);
  return positions.map((position, index) => {
    const previous =
      existing[index] ||
      existing.find((chair) => Number(chair.seatNumber) === index + 1) ||
      {};
    return {
      // Legacy table documents did not store chair IDs.  IDs must be stable
      // across every hydration so the chair selected in the UI is the same
      // chair the live transaction validates and writes.
      id: previous.id || `${tableId}-chair-${index + 1}`,
      seatNumber: index + 1,
      guestId: previous.guestId || "",
      assignment: previous.assignment || null,
      status: previous.status || "available",
      x: position.x,
      y: position.y,
      notes: previous.notes || "",
      vip: Boolean(previous.vip),
    };
  });
}

function buildChairPositions(shape, seatCount) {
  if (shape === "round") {
    return Array.from({ length: seatCount }, (_, index) => {
      const angle = -Math.PI / 2 + (index / seatCount) * Math.PI * 2;
      return {
        x: 50 + Math.cos(angle) * 42,
        y: 50 + Math.sin(angle) * 42,
      };
    });
  }

  if (shape === "horseshoe" || shape === "u-shape" || shape === "open-u") {
    const spread = Math.max(seatCount, 6);
    return Array.from({ length: seatCount }, (_, index) => {
      const angle = Math.PI + (index / Math.max(1, spread - 1)) * Math.PI;
      return {
        x: 50 + Math.cos(angle) * 42,
        y: 58 + Math.sin(angle) * 34,
      };
    });
  }

  const sides = distributePerimeterSeats(seatCount);
  const points = [];
  const pushRange = (count, x1, y1, x2, y2) => {
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    }
  };
  pushRange(sides.top, 24, 8, 76, 8);
  pushRange(sides.right, 92, 20, 92, 80);
  pushRange(sides.bottom, 76, 92, 24, 92);
  pushRange(sides.left, 8, 80, 8, 20);
  return points.slice(0, seatCount);
}

function distributePerimeterSeats(seatCount) {
  const base = Math.floor(seatCount / 4);
  let remainder = seatCount % 4;
  const result = { top: base, right: base, bottom: base, left: base };
  ["top", "right", "bottom", "left"].forEach((key) => {
    if (remainder > 0) {
      result[key] += 1;
      remainder -= 1;
    }
  });
  Object.keys(result).forEach((key) => {
    result[key] = Math.max(result[key], 1);
  });
  return result;
}

function getTableGuests(tableId) {
  return uniqueGuestsFromAssignments(getTableAssignments(tableId));
}

function getSelectedTable() {
  return (
    state.tables.find((item) => item.id === state.selectedTableId) ||
    state.tables[0] ||
    null
  );
}

function findGuestSeat(guestId) {
  const assignment = getGuestAssignedSeats(guestId)[0];
  return assignment
    ? { tableId: assignment.tableId, chairId: assignment.chairId }
    : null;
}

function getSelectedSeat() {
  if (!state.selectedSeatId) {
    return null;
  }
  const [tableId, chairId] = state.selectedSeatId.split("::");
  const table = state.tables.find((item) => item.id === tableId);
  const chair = table?.chairs.find((item) => item.id === chairId);
  const assignment = chair ? getChairAssignment(table.id, chair) : null;
  const guest = assignment?.guestId
    ? state.guests.find((item) => item.id === assignment.guestId)
    : null;
  if (!table || !chair) {
    return null;
  }
  return { table, chair, guest, assignment };
}

function getAssignableGuests() {
  return state.guests
    .filter((guest) => getGuestRemainingSeats(guest) > 0)
    .filter((guest) => {
      if (
        state.libraryFilters.rsvp === "pending" &&
        guest.rsvpStatus !== "pending"
      ) {
        return false;
      }
      if (
        state.libraryFilters.side !== "all" &&
        guest.side !== state.libraryFilters.side
      ) {
        return false;
      }
      if (state.libraryFilters.vipOnly && !/vip/i.test(guest.notes || "")) {
        return false;
      }
      return true;
    })
    .sort((a, b) => guestPriorityScore(a) - guestPriorityScore(b));
}

function getSeatCandidates(currentGuestId) {
  return [...state.guests]
    .filter(
      (guest) =>
        getGuestRemainingSeats(guest) > 0 || guest.id === currentGuestId,
    )
    .filter((guest) => {
      if (!state.guestAssignmentSearch) {
        return true;
      }
      return [
        guest.fullName,
        guest.phone,
        guest.side,
        guest.rsvpStatus,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(state.guestAssignmentSearch),
      );
    })
    .sort((a, b) => {
      const priority = guestPriorityScore(a) - guestPriorityScore(b);
      if (priority !== 0) {
        return priority;
      }
      if (a.id === currentGuestId) {
        return -1;
      }
      if (b.id === currentGuestId) {
        return 1;
      }
      return String(a.fullName || "").localeCompare(String(b.fullName || ""));
    });
}

function guestPriorityScore(guest) {
  const statusPriority = { confirmed: 0, pending: 1, declined: 2 };
  const seatedPenalty = getGuestAssignedSeats(guest.id).length ? 4 : 0;
  const vipBoost = /vip/i.test(guest.notes || "") ? -1 : 0;
  return (statusPriority[guest.rsvpStatus] ?? 3) + seatedPenalty + vipBoost;
}

function chairStatusClass(chair, guest, assignment = null) {
  if (chair.vip) {
    return "vip";
  }
  if (guest?.rsvpStatus === "declined") {
    return "conflict";
  }
  if (guest?.rsvpStatus === "pending") {
    return "warning";
  }
  if (guest || assignment) {
    return "assigned";
  }
  return chair.status || "available";
}

function buildSeatKey(tableId, chairId) {
  return `${tableId}::${chairId}`;
}

function resolveChairColor(status, table) {
  switch (status) {
    case "assigned":
      return "#2E6D61";
    case "vip":
      return "#B89156";
    case "warning":
      return "#BE8741";
    case "conflict":
      return "#B25B54";
    default:
      return "#F8FAF6";
  }
}

function createHallObjects() {
  return [
    { id: "stage-default", type: "stage", label: "Stage", x: 50, y: 8 },
    {
      id: "entrance-default",
      type: "entrance",
      label: "Entrance",
      x: 50,
      y: 90,
    },
  ];
}

function handlePlannerPointerCancel(event) {
  if (!state.dragState || state.dragState.pointerId !== event.pointerId) return;
  const dragState = state.dragState;
  if (dragState.type === "pan") {
    state.plannerViewCenter = dragState.startCenter;
    restorePlannerViewport();
    dragState.node?.classList.remove("is-panning");
    document.body.classList.remove("is-planner-panning");
  } else if (dragState.type === "table") {
    state.tables = state.tables.map((table) => table.id === dragState.tableId
      ? { ...table, x: dragState.originalX, y: dragState.originalY }
      : table);
    renderActiveView();
  } else if (dragState.type === "hall-object") {
    state.hallObjects = state.hallObjects.map((item) => item.id === dragState.objectId
      ? { ...item, x: dragState.originalX, y: dragState.originalY }
      : item);
    renderActiveView();
  }
  try { document.getElementById("plannerViewport")?.releasePointerCapture(event.pointerId); } catch {}
  state.dragState = null;
}

function calculateGuestDirectoryCounts(guests) {
  const primary = guests.length;
  const accompanying = guests.reduce(
    (sum, guest) => sum + normalizeAdditionalGuests(guest.additionalGuests),
    0,
  );
  return { primary, accompanying, people: primary + accompanying };
}

function hydrateHallObjects(savedObjects) {
  const saved = Array.isArray(savedObjects)
    ? savedObjects.filter((item) => item && item.id && item.type)
    : [];
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const defaults = createHallObjects().map((item) => ({
    ...item,
    ...(savedById.get(item.id) || {}),
  }));
  const customObjects = saved.filter(
    (item) => !defaults.some((defaultItem) => defaultItem.id === item.id),
  );
  return [...defaults, ...customObjects].map(normalizeHallObject);
}

function normalizeHallObject(item) {
  const base = {
    id: item.id || createId("venue"),
    type: item.type || "stage",
    label: item.label || prettifyShape(item.type || "venue object"),
    x: clamp(Number(item.x ?? 50), 5, 95),
    y: clamp(Number(item.y ?? 50), 5, 95),
    locked: Boolean(item.locked),
  };
  if (base.type !== "dance-floor") return { ...item, ...base };
  const shape = item.shape === "rectangle" ? "rectangle" : "round";
  const width = clamp(Number(item.width || 300), 120, 700);
  return {
    ...item,
    ...base,
    shape,
    width,
    height: shape === "round" ? width : clamp(Number(item.height || 220), 120, 700),
    rotation: clamp(Number(item.rotation || 0), 0, 360),
    floorZone: item.floorZone || "",
    fillColor: item.fillColor || "#2F6F64",
    borderColor: item.borderColor || "#D7B56D",
    notes: item.notes || "",
  };
}

function getSelectedHallObject() {
  return state.hallObjects.find((item) => item.id === state.selectedHallObjectId) || null;
}

async function persistHallObjects(errorMessage = "Venue layout could not be saved.") {
  if (state.mode === "demo") {
    persistDemoDashboardState();
    return true;
  }
  setSaveState("saving");
  try {
    await updateDoc(doc(state.services.db, "weddings", state.weddingId), {
      hallObjects: state.hallObjects,
      updatedAt: serverTimestamp(),
    });
    setSaveState("saved");
    return true;
  } catch (error) {
    console.error(error);
    setSaveState("saved");
    showToast(errorMessage, "error");
    return false;
  }
}

function restoreGuestSearchFocus(selectionStart, selectionEnd) {
  requestAnimationFrame(() => {
    if (state.activeView !== "guests") return;
    const search = elements.pageContent.querySelector("[data-guest-search]");
    if (!search) return;
    search.focus({ preventScroll: true });
    const length = search.value.length;
    search.setSelectionRange?.(
      Math.min(selectionStart ?? length, length),
      Math.min(selectionEnd ?? length, length),
    );
  });
}

function syncDanceFloorDimensions() {
  const isRound = elements.danceFloorForm.shape.value === "round";
  const heightField = elements.danceFloorForm.height;
  const heightLabel = document.querySelector("[data-dance-floor-height]");
  document.getElementById("danceFloorWidthLabel").textContent = isRound ? "Diameter" : "Width";
  heightField.disabled = isRound;
  heightLabel.hidden = isRound;
  if (isRound) heightField.value = elements.danceFloorForm.width.value;
}

function openDanceFloorModal(item = null) {
  if (!canManageSeatingLayout()) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }
  state.selectedHallObjectId = item?.id || "";
  state.dirtyDanceFloorForm = false;
  elements.danceFloorModalTitle.textContent = item ? "Edit Dance Floor" : "Add Dance Floor";
  elements.danceFloorForm.reset();
  elements.danceFloorForm.label.value = item?.label || "Dance Floor";
  elements.danceFloorForm.shape.value = item?.shape || "round";
  elements.danceFloorForm.width.value = item?.width || 300;
  elements.danceFloorForm.height.value = item?.height || 300;
  elements.danceFloorForm.rotation.value = item?.rotation || 0;
  elements.danceFloorForm.floorZone.value = item?.floorZone || "";
  elements.danceFloorForm.fillColor.value = item?.fillColor || "#2F6F64";
  elements.danceFloorForm.borderColor.value = item?.borderColor || "#D7B56D";
  elements.danceFloorForm.notes.value = item?.notes || "";
  syncDanceFloorDimensions();
  document.body.classList.add("is-modal-open");
  elements.danceFloorModal.showModal();
  requestAnimationFrame(() => elements.danceFloorForm.label.focus());
}

async function saveDanceFloor(event) {
  event.preventDefault();
  if (!canManageSeatingLayout()) return;
  const form = elements.danceFloorForm;
  const shape = form.shape.value === "rectangle" ? "rectangle" : "round";
  const width = Number(form.width.value);
  const height = shape === "round" ? width : Number(form.height.value);
  const rotation = Number(form.rotation.value || 0);
  if (![width, height].every((value) => value >= 120 && value <= 700) || rotation < 0 || rotation > 360) {
    showToast("Use dimensions between 120 and 700 pixels and rotation from 0 to 360°.", "error");
    return;
  }
  const existing = getSelectedHallObject();
  const floor = normalizeHallObject({
    id: existing?.id || createId("dance-floor"), type: "dance-floor", label: form.label.value.trim() || "Dance Floor", shape,
    x: existing?.x ?? 50, y: existing?.y ?? 50, width, height, rotation,
    floorZone: form.floorZone.value.trim(), fillColor: form.fillColor.value, borderColor: form.borderColor.value,
    notes: form.notes.value.trim(), locked: existing?.locked || false,
  });
  state.hallObjects = existing ? state.hallObjects.map((item) => item.id === existing.id ? floor : item) : [...state.hallObjects, floor];
  state.selectedHallObjectId = floor.id;
  state.selectedTableId = "";
  if (await persistHallObjects("Dance floor could not be saved.")) {
    state.dirtyDanceFloorForm = false;
    elements.danceFloorModal.close();
    renderActiveView();
    showToast("Dance floor saved.", "success");
  }
}

async function duplicateDanceFloor(id) {
  const item = state.hallObjects.find((object) => object.id === id && object.type === "dance-floor");
  if (!item || !canManageSeatingLayout()) return;
  const copy = normalizeHallObject({ ...item, id: createId("dance-floor"), label: `${item.label} copy`, x: clamp(item.x + 5, 5, 95), y: clamp(item.y + 5, 5, 95), locked: false });
  state.hallObjects = [...state.hallObjects, copy]; state.selectedHallObjectId = copy.id;
  state.selectedTableId = "";
  if (await persistHallObjects("Dance floor could not be duplicated.")) renderActiveView();
}

async function deleteDanceFloor(id) {
  const item = state.hallObjects.find((object) => object.id === id && object.type === "dance-floor");
  if (!item || !canManageSeatingLayout() || !window.confirm(`Delete ${item.label}? This cannot be undone.`)) return;
  state.hallObjects = state.hallObjects.filter((object) => object.id !== id); state.selectedHallObjectId = "";
  if (await persistHallObjects("Dance floor could not be deleted.")) renderActiveView();
}

async function toggleHallObjectLock(id) {
  if (!canManageSeatingLayout()) return;
  state.hallObjects = state.hallObjects.map((item) => item.id === id ? { ...item, locked: !item.locked } : item);
  if (await persistHallObjects("Venue object lock state could not be saved.")) renderActiveView();
}

function redirectToLogin(message = "session-required") {
  state.unsubGuests?.();
  state.unsubTables?.();
  window.location.replace(buildLoginUrl(message));
}

async function resolveAccessibleWeddingId(user) {
  const rememberedWeddingId = localStorage.getItem(lastWeddingStorageKey);
  if (
    rememberedWeddingId &&
    (await canViewWedding(user, rememberedWeddingId))
  ) {
    return rememberedWeddingId;
  }

  const snapshot = await getDocs(
    query(
      collection(state.services.db, "weddings"),
      where("status", "==", "active"),
    ),
  );
  for (const weddingDoc of snapshot.docs) {
    if (await canViewWedding(user, weddingDoc.id)) {
      rememberWeddingId(weddingDoc.id);
      return weddingDoc.id;
    }
  }
  return "";
}

async function canViewWedding(user, weddingId) {
  const permissionDoc = await getDoc(
    doc(state.services.db, "weddings", weddingId, "dashboardUsers", user.uid),
  );
  return permissionDoc.exists() && permissionDoc.data().canViewDashboard;
}

function rememberWeddingId(weddingId) {
  localStorage.setItem(lastWeddingStorageKey, weddingId);
}

function buildLoginUrl(message) {
  const nextParams = new URLSearchParams();
  if (state.weddingId) {
    nextParams.set("wedding", state.weddingId);
  }
  if (state.mode === "demo") {
    nextParams.set("demo", "1");
  }
  if (state.editorMode && !state.secureEditorMode) {
    nextParams.set("seatingOnly", "1");
  }
  if (message) {
    nextParams.set("message", message);
  }
  const query = nextParams.toString();
  return query ? `./dashboard-login.html?${query}` : "./dashboard-login.html";
}

function materializeDemoPayload(payload, existingGuest = null) {
  const next = { ...payload };
  if (next.updatedAt && typeof next.updatedAt === "object") {
    next.updatedAt = demoNow();
  }
  if (next.checkedInAt && typeof next.checkedInAt === "object") {
    next.checkedInAt = demoNow();
  }
  if (!next.inviteSentAt && existingGuest?.inviteSentAt) {
    next.inviteSentAt = existingGuest.inviteSentAt;
  }
  if (!next.reminderSentAt && existingGuest?.reminderSentAt) {
    next.reminderSentAt = existingGuest.reminderSentAt;
  }
  return next;
}

function defaultWidthForShape(shape) {
  switch (shape) {
    case "rectangle":
    case "conference":
    case "long-banquet":
      return 230;
    case "horseshoe":
    case "u-shape":
    case "open-u":
      return 220;
    case "square":
      return 170;
    default:
      return 180;
  }
}

function defaultHeightForShape(shape) {
  switch (shape) {
    case "rectangle":
    case "conference":
    case "long-banquet":
      return 140;
    case "horseshoe":
    case "u-shape":
    case "open-u":
      return 170;
    case "square":
      return 170;
    default:
      return 180;
  }
}

function prettifyShape(shape) {
  return String(shape || "round")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function can(permission) {
  return Boolean(state.permissions?.[permission]);
}

function canManageSeatingLayout() {
  return can("canEditSeating") && !state.editorMode;
}

function signedInUserName() {
  const profileName = state.permissions?.displayName || state.permissions?.name;
  if (profileName) return profileName;
  if (state.currentUser?.displayName) return state.currentUser.displayName;
  const email = state.currentUser?.email || "";
  return email || "Signed-in user";
}

function setSaveState(value) {
  state.saveState = value;
  if (state.activeView === "seating") {
    renderActiveView();
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    showToast("Copied to clipboard.", "success");
  } catch (error) {
    console.error(error);
    showToast("Could not copy the link automatically.", "error");
  }
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function formatEventDate(value) {
  if (!value) {
    return "Date not set";
  }
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(value);
  }
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }
  return String(value);
}

function toTimeValue(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getInitials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildWhatsAppReminderLink(guest) {
  if (!guest) {
    return "";
  }
  const phone = normalizeWhatsAppPhone(guest.phone);
  if (!phone) {
    return "";
  }
  const title = getEventDisplayTitle(state.wedding);
  const message = `Hello ${guest.fullName || "Guest"}, this is a kind reminder to confirm your attendance for ${title}.\nPlease open your personal invitation here:\n${buildInviteLink(guest.guestToken)}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function cleanPhone(phone) {
  return normalizeDigits(String(phone || "")).replace(/[^\d]/g, "");
}

// Maps Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to ASCII.
function normalizeDigits(value) {
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) & 0xf),
  );
}

// wa.me links require country-code-prefixed numbers with no leading zero.
// Local formats like 0501234567 get the wedding's country code prepended.
function normalizeWhatsAppPhone(phone) {
  const raw = String(phone || "").trim();
  const digits = cleanPhone(phone);
  if (!digits) {
    return "";
  }
  if (raw.startsWith("+")) {
    return digits;
  }
  if (digits.startsWith("00")) {
    return digits.replace(/^0+/, "");
  }
  if (digits.startsWith("0")) {
    const countryCode = String(state.wedding?.whatsappCountryCode || "971");
    return `${countryCode}${digits.replace(/^0+/, "")}`;
  }
  return digits;
}

function buildInviteLink(guestToken) {
  return new URL(
    `index.html?wedding=${encodeURIComponent(state.weddingId)}&guest=${encodeURIComponent(guestToken)}`,
    window.location.href,
  ).toString();
}

function buildCheckinLink(guestToken) {
  return new URL(
    `checkin.html?wedding=${encodeURIComponent(state.weddingId)}&guest=${encodeURIComponent(guestToken)}`,
    window.location.href,
  ).toString();
}

// Sender lists mirror the Guest Directory's side field exactly. This prevents
// Legacy "both" aliases are assigned to Groom so they appear in one sender list.
function senderSideMatches(guest, side) {
  if (side === "all") {
    return true;
  }
  return normalizeGuestSide(guest.side) === side;
}

function getSenderGuests(side = "all") {
  return state.guests.filter(
    (guest) =>
      normalizeWhatsAppPhone(guest.phone) &&
      guest.guestToken &&
      senderSideMatches(guest, side),
  );
}

function getGuestSeatReadiness(guest) {
  const assignments = getGuestAssignedSeats(guest.id)
    .map((assignment) => ({
      ...assignment,
      personKey:
        assignment.personKey || personKeyForIndex(assignment.partyMemberIndex),
      label:
        assignment.label || partyLabelForIndex(assignment.partyMemberIndex),
    }))
    .filter(
      (assignment) =>
        assignment.tableId &&
        assignment.chairId &&
        Number(assignment.seatNumber) > 0,
    )
    .sort(
      (a, b) => partyIndexFromKey(a.personKey) - partyIndexFromKey(b.personKey),
    );
  const requiredPeople = Array.from(
    { length: getPartySize(guest) },
    (_, index) => ({
      personKey: personKeyForIndex(index),
      label: partyLabelForIndex(index),
    }),
  );
  const requiredKeys = new Set(
    requiredPeople.map((person) => person.personKey),
  );
  const assignedKeys = new Set(
    assignments
      .filter((assignment) => requiredKeys.has(assignment.personKey))
      .map((assignment) => assignment.personKey),
  );
  const missing = requiredPeople.filter(
    (person) => !assignedKeys.has(person.personKey),
  );
  return {
    assignments,
    missing,
    assignedCount: assignedKeys.size,
    requiredCount: requiredPeople.length,
    ready: missing.length === 0 && assignedKeys.size === requiredPeople.length,
  };
}

function ensureSenderSeatsReady(side = "all") {
  if (!isSeatingEnabled()) return true;
  const blocked = getSenderGuests(side)
    .map((guest) => ({ guest, readiness: getGuestSeatReadiness(guest) }))
    .filter((entry) => entry.readiness.missing.length);
  if (!blocked.length) {
    return true;
  }
  renderMissingSeatsModal(blocked, side);
  openCenteredModal(elements.missingSeatsModal);
  return false;
}

function renderMissingSeatsModal(blocked, side = "all") {
  if (!elements.missingSeatsContent) {
    return;
  }
  const firstGuest = blocked[0]?.guest;
  elements.missingSeatsContent.innerHTML = `
    <div class="da3wa-sheet__header">
      <div>
        <p class="da3wa-eyebrow">Seats required</p>
        <h2>Complete seating before sending</h2>
      </div>
      <button class="da3wa-icon-button" type="button" data-close-modal="missingSeatsModal" aria-label="Close missing seats warning">x</button>
    </div>
    <div class="da3wa-sheet__body">
      <p class="planner-note">Every person in an invitation needs an assigned chair before sending. You can still open the sender now if you want to send invitations before seating is complete.</p>
      <div class="planner-warning-list">
        ${blocked
          .map(
            ({ guest, readiness }) => `
          <div class="chair-detail-row">
            <strong>${escapeHtml(guest.fullName || "Guest")}</strong>
            <span>Missing: ${readiness.missing.map((item) => escapeHtml(item.label)).join(", ")}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
    <div class="da3wa-sheet__footer">
      <button class="da3wa-button da3wa-button--secondary" type="button" data-close-modal="missingSeatsModal">Cancel</button>
      <button class="da3wa-button da3wa-button--secondary" type="button" data-action="open-sender-anyway" data-id="${escapeAttribute(side)}">Open send anyway</button>
      <button class="da3wa-button da3wa-button--primary" type="button" data-action="open-seating-for-guest" data-guest-id="${escapeAttribute(firstGuest?.id || "")}">Open seating planner</button>
    </div>
  `;
}

function buildSenderLink(side = "all") {
  const payload = createSenderPayload({
    weddingId: state.weddingId,
    coupleName: getEventDisplayTitle(state.wedding),
    eventCategory: state.wedding?.eventCategory || "wedding_engagement",
    side,
    guests: getSenderGuests(side).map((guest) => ({
      ...guest,
      phone: normalizeWhatsAppPhone(guest.phone),
    })),
  });
  return new URL(
    `send.html#data=${encodeSenderPayload(payload)}`,
    window.location.href,
  ).toString();
}

function buildSideViewLink(side) {
  // Bride and Groom pages are authenticated, side-scoped seating workspaces.
  // Family remains a public read-only status page.  No readonly query flag is
  // used for the managers, and the dashboard repeats the wedding + side
  // context after sign-in.
  if (["bride", "groom"].includes(side) && state.mode !== "demo") {
    const managerParams = new URLSearchParams({
      wedding: state.weddingId,
      seatingOnly: "1",
      side,
    });
    return new URL(
      `dashboard-login.html?${managerParams.toString()}`,
      window.location.href,
    ).toString();
  }
  const linkParams = new URLSearchParams();
  if (state.mode === "demo") {
    linkParams.set("demo", "1");
  } else {
    linkParams.set("wedding", state.weddingId);
  }
  linkParams.set("side", side);
  return new URL(
    `side.html?${linkParams.toString()}`,
    window.location.href,
  ).toString();
}

function generateGuestToken() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function demoNow() {
  return new Date().toLocaleString();
}

function showToast(message, tone = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;
  toast.textContent = message;
  elements.toastRail.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 260);
  }, 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
