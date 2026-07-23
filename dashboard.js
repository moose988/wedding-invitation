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

const params = new URLSearchParams(window.location.search);
const secureSeatingEditorMode = params.get("seatingEditor") === "1";
const accountSeatingEditorMode = params.get("seatingOnly") === "1";
const seatingEditorMode = secureSeatingEditorMode || accountSeatingEditorMode;
const lastWeddingStorageKey = "da3wa:lastDashboardWeddingId";
const demoDashboardStorageKey = "da3wa:demoDashboardState:v4";
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
  guests: {
    eyebrow: "Guest management",
    title: "Guest Directory",
    description:
      "Search, sort, filter, and update every invitee from a single operational directory.",
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
    eyebrow: "Invitation sharing",
    title: "Links & Invitations",
    description:
      "Copy the right public or operational link for planners, hosts, and invited guests.",
  },
  exports: {
    eyebrow: "Data exports",
    title: "Exports",
    description:
      "Download guest lists and seating views without disturbing live event data.",
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
    label: "VIP 1",
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
    label: "Family A",
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
    label: "Bride 3",
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
    fullNameAr: "نور أحمد",
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
    fullNameAr: "عمر حسن",
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
    fullNameAr: "ليلى سعيد",
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
    fullNameAr: "خالد منصور",
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
    fullNameAr: "ميرا رحمن",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
    phone: "971500000015",
    side: "both",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
    phone: "971500000024",
    side: "both",
    additionalGuests: 1,
    rsvpStatus: "pending",
    guestToken: "demo-token-24",
    tableId: "",
    tableName: "",
    seatNumber: "",
    checkedIn: false,
    checkedInAt: null,
    notes: "Friend of both families",
    inviteSentAt: "Yesterday, 3:10 PM",
    reminderSentAt: null,
    createdAt: "Yesterday, 3:10 PM",
    updatedAt: "Yesterday, 3:10 PM",
  },
  {
    id: "guest-25",
    fullName: "Tariq Nabil",
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
    fullNameAr: "",
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
  fullNameAr: "",
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
  // A real Firestore wedding may legitimately use a demo-looking ID. Keep
  // local preview data opt-in only, otherwise the dashboard must read the
  // exact guests and tables stored in Firestore.
  mode: params.get("demo") === "1" ? "demo" : "live",
  services: null,
  currentUser: null,
  permissions: null,
  wedding: null,
  guests: [],
  tables: [],
  hallObjects: createHallObjects(),
  selectedGuestId: "",
  selectedGuestIds: [],
  activeView: "overview",
  selectedTableId: "",
  selectedSeatId: "",
  seatingMode: "layout",
  guestAssignmentSearch: "",
  assignmentSession: null,
  activePartyGuestId: "",
  pendingPartyUnassignId: "",
  pendingPartyUnassignSignature: "",
  activeModalOperation: "",
  modalError: "",
  returnFocusSelector: "",
  plannerZoom: 1,
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
  authRedirectMessage: "",
  loadingGuests: true,
  loadingTables: true,
  firestoreGuestCount: 0,
  firestoreGuestIds: [],
  publicMirrorsReconciled: false,
  saveState: "saved",
  dirtyGuestForm: false,
  dirtyTableForm: false,
  unsubGuests: null,
  unsubTables: null,
  unsubSeatingAccess: null,
  seatingAccess: { bride: null, groom: null, family: null },
};

const elements = {
  dashboardApp: document.getElementById("dashboardApp"),
  dashboardSidebar: document.getElementById("dashboardSidebar"),
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
  bindEvents();

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

  onAuthStateChanged(state.services.auth, async (user) => {
    state.currentUser = user;
    if (!user) {
      const message = state.authRedirectMessage || "session-required";
      state.authRedirectMessage = "";
      redirectToLogin(message);
      return;
    }
    if (!state.weddingId) {
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
    state.sidebarOpen = !state.sidebarOpen;
    updateSidebarState();
  });
  elements.guestForm?.addEventListener("submit", saveGuest);
  elements.tableForm?.addEventListener("submit", saveTable);
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

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("keydown", handleDocumentKeydown);
  elements.guestModal?.addEventListener("click", handleDialogBackdropClick);
  elements.bulkAddModal?.addEventListener("click", handleDialogBackdropClick);
  elements.tableModal?.addEventListener("click", handleDialogBackdropClick);
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
  window.addEventListener("pointermove", handlePlannerPointerMove);
  window.addEventListener("pointerup", handlePlannerPointerUp);
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
    state.guestFilters.search = search.value.trim();
    state.guestPageIndex = 0;
    closeGuestMenu({ restoreFocus: false });
    renderActiveView();
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
    state.wedding = { coupleName: "", status: "active" };
    state.activeView = "seating";
    showDashboard();
    renderAll();
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
    state.sidebarOpen = false;
    updateSidebarState();
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
  state.tables = hydrateTables(savedDemoState?.tables || demoTables);
  state.guests = syncGuestSeatingSummaries(state.guests, state.tables);
  state.hallObjects = hydrateHallObjects(savedDemoState?.hallObjects);
  state.loadingTables = false;
  state.selectedTableId = state.tables[0]?.id || "";
  showDashboard();
  renderAll();
  showToast(message, "info");
}

function mergeDemoSeedGuests(savedGuests) {
  const savedById = new Map(savedGuests.map((guest) => [guest.id, guest]));
  const deletedSeedIds = new Set(state.deletedSeedGuestIds || []);
  const merged = demoSeedGuests
    .filter((seedGuest) => !deletedSeedIds.has(seedGuest.id))
    .map((seedGuest) => ({
      ...seedGuest,
      ...(savedById.get(seedGuest.id) || {}),
    }));
  const customGuests = savedGuests.filter(
    (guest) => !demoSeedGuests.some((seedGuest) => seedGuest.id === guest.id),
  );
  return [...merged, ...customGuests];
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
  }
  if (state.editorMode) {
    if (!state.permissions.canEditSeating) {
      redirectToLogin("access-denied");
      return;
    }
    state.editorRole = "account";
    state.activeView = "seating";
  }
  rememberWeddingId(state.weddingId);
  const weddingDoc = await getDoc(
    doc(state.services.db, "weddings", state.weddingId),
  );
  state.wedding = weddingDoc.exists() ? weddingDoc.data() : null;
  state.hallObjects = hydrateHallObjects(state.wedding?.hallObjects);
  if (isWeddingOwner()) {
    try {
      const normalizeSides = httpsCallable(
        state.services.functions,
        "normalizeSeatingGuestSides",
      );
      await normalizeSides({ weddingId: state.weddingId });
    } catch (error) {
      console.error("Guest-side normalization failed.", error);
      showToast(
        "Guest sides could not be normalized. Seating access may be limited until this is resolved.",
        "error",
      );
    }
  }
  showDashboard();
  renderAll();
  startListeners();
  startSeatingAccessListener();
}

function isWeddingOwner() {
  return Boolean(
    state.currentUser?.uid &&
      state.wedding?.ownerUserId === state.currentUser.uid,
  );
}

function canManageSeatingAccess() {
  return isWeddingOwner() || state.permissions?.canManageUsers === true;
}

function startSeatingAccessListener() {
  state.unsubSeatingAccess?.();
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
  state.loadingGuests = true;
  state.loadingTables = true;
  renderActiveView();

  const guestSource = state.secureEditorMode
    ? query(
        collection(state.services.db, "weddings", state.weddingId, "guests"),
        where("side", "in", editorGuestSideValues(state.editorRole)),
      )
    : collection(state.services.db, "weddings", state.weddingId, "guests");
  state.unsubGuests = onSnapshot(
    guestSource,
    (snapshot) => {
      state.guests = snapshot.docs.map((docSnapshot) => ({
        ...docSnapshot.data(),
        id: docSnapshot.id,
        side: normalizeGuestSide(docSnapshot.data().side),
      }));
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
      state.tables = hydrateTables(
        snapshot.docs.map((docSnapshot) => ({
          ...docSnapshot.data(),
          id: docSnapshot.id,
        })),
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

function handleSeatingListenerError(error) {
  console.error(error);
  if (state.editorMode && error?.code === "permission-denied") {
    state.unsubGuests?.();
    state.unsubTables?.();
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
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side"].includes(side)) return "groom";
  if (["both", "both sides", "shared"].includes(side)) return "both";
  return "family";
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
        "both",
        "Both",
        "both sides",
        "Both Sides",
        "shared",
        "Shared",
      ];
}

function buildPublicStatsPayload() {
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
      a: guest.fullNameAr || "",
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
  return { coupleName: state.wedding?.coupleName || "", sides, roster };
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
  document.body.classList.toggle("is-seating-view", isSeatingView);
  document.body.classList.toggle("is-seating-editor", state.editorMode);
  elements.dashboardSidebar.hidden = state.secureEditorMode;
  elements.dashboardSidebar.classList.toggle(
    "is-seating-only",
    state.editorMode && !state.secureEditorMode,
  );
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
    ? state.editorRole === "account"
      ? "Seating Editor"
      : `${state.editorRole[0].toUpperCase()}${state.editorRole.slice(1)} — Seating Editor`
    : isSeatingView
      ? ""
      : meta.title;
  elements.pageDescription.textContent = state.editorMode
    ? "Changes are synchronized live with the wedding dashboard."
    : isSeatingView
      ? ""
      : meta.description;
  elements.liveIndicator.innerHTML =
    state.mode === "demo"
      ? "Preview mode"
      : `Firestore: ${state.firestoreGuestCount} guest${state.firestoreGuestCount === 1 ? "" : "s"}`;

  document.querySelectorAll("[data-nav-view]").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.navView === state.activeView,
    );
  });

  updateSidebarState();
  renderGlobalActions();
}

function updateSidebarState() {
  elements.dashboardSidebar.classList.toggle("is-open", state.sidebarOpen);
}

function renderGlobalActions() {
  const actions = [];
  if (state.editorMode) {
    elements.globalActions.innerHTML = "";
    return;
  }
  if (state.activeView === "overview" || state.activeView === "guests") {
    actions.push(
      actionButton(
        "Add guest",
        "open-add-guest",
        !can("canEditGuests"),
        "primary",
      ),
    );
  }
  if (state.activeView === "guests") {
    actions.push(
      actionButton(
        "Bulk add",
        "open-bulk-add",
        !can("canEditGuests"),
        "secondary",
      ),
    );
  }
  if (state.activeView !== "seating") {
    actions.push(
      actionButton("Refresh", "refresh-dashboard", false, "secondary"),
    );
  }

  elements.globalActions.innerHTML = actions.join("");
}

function switchView(view) {
  if (state.editorMode && view !== "seating") return;
  if (!pageMeta[view]) {
    return;
  }
  closeGuestMenu({ restoreFocus: false });
  state.activeView = view;
  state.sidebarOpen = false;
  renderAll();
}

function renderActiveView() {
  switch (state.activeView) {
    case "overview":
      renderOverviewPage();
      break;
    case "guests":
      renderGuestPage();
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

function renderOverviewPage() {
  if (state.loadingGuests || state.loadingTables) {
    elements.pageContent.innerHTML =
      '<div class="da3wa-skeleton" aria-hidden="true"></div>';
    return;
  }

  const stats = calculateDashboardStats(state.guests, state.tables);
  const attention = calculateAttention(state.guests, state.tables);
  const recentActivity = deriveRecentActivity(state.guests);
  const distribution = calculateSideDistribution(state.guests);
  const sideStats = calculateSideStats(state.guests, state.tables);

  elements.pageContent.innerHTML = `
    <section class="overview-page">
      <article class="overview-hero">
        <div class="overview-hero__meta">
          <span class="pill">${escapeHtml(state.wedding?.status || "active")}</span>
          <span class="pill pill--live">${state.mode === "demo" ? "Preview data" : "Realtime updates"}</span>
          <span class="pill">${formatEventDate(state.wedding?.eventDateISO)}</span>
          <span class="pill">${escapeHtml(state.wedding?.venueEn || "Venue not set")}</span>
        </div>
        <div>
          <p class="da3wa-eyebrow">Event status</p>
          <h2>${escapeHtml(state.wedding?.coupleName || "Current Wedding")}</h2>
          <p class="overview-hero__subline">Track invitations, guest readiness, and ballroom setup from a calmer operational view.</p>
        </div>
      </article>

      <section class="overview-kpis">
        ${renderKpiCard("Total invited", stats.total, `${stats.confirmedPct}% confirmed`, "Live guest count")}
        ${renderKpiCard("Confirmed", stats.confirmed, `${stats.confirmedPct}% of total`, "RSVP accepted")}
        ${renderKpiCard("Pending", stats.pending, `${stats.pendingPct}% awaiting response`, "Needs follow-up")}
        ${renderKpiCard("Declined", stats.declined, `${stats.declinedPct}% declined`, "Unavailable")}
        ${renderKpiCard("Checked in", stats.checkedIn, `${stats.checkinPct}% arrived`, "Venue arrivals")}
        ${renderKpiCard("Without seats", stats.withoutSeat, `${stats.withoutSeatPct}% need placement`, "Seating attention")}
      </section>

      <section class="side-overview">
        ${renderSideOverviewCard("Groom side", "groom", sideStats.groom)}
        ${renderSideOverviewCard("Bride side", "bride", sideStats.bride)}
        ${sideStats.other.guestCount ? renderSideOverviewCard("Family & shared", "other", sideStats.other) : ""}
      </section>

      <section class="overview-analytics">
        <article class="analytics-card">
          <p class="da3wa-eyebrow">RSVP progress</p>
          <h3>Response completion</h3>
          <div class="progress-stack">
            ${progressRow("Confirmed", stats.confirmed, stats.total, "sage")}
            ${progressRow("Pending", stats.pending, stats.total, "amber")}
            ${progressRow("Declined", stats.declined, stats.total, "rose")}
          </div>
        </article>

        <article class="analytics-card">
          <p class="da3wa-eyebrow">Seating progress</p>
          <h3>Assignment readiness</h3>
          <div class="progress-stack">
            ${progressRow("Assigned guests", stats.seatedGuests, stats.total, "sage")}
            ${progressRow("Guest parties needing seats", stats.unassignedGuests, stats.total, "amber")}
            ${progressRow("Seats remaining", stats.remainingSeats, Math.max(stats.totalSeats, 1), "rose")}
          </div>
        </article>

        <article class="analytics-card">
          <p class="da3wa-eyebrow">Check-in progress</p>
          <h3>Arrival tracking</h3>
          <div class="progress-stack">
            ${progressRow("Checked in", stats.checkedIn, stats.total, "sage")}
            ${progressRow("Awaiting arrival", stats.notCheckedIn, stats.total, "amber")}
          </div>
        </article>

        <article class="analytics-card">
          <p class="da3wa-eyebrow">Guest-side distribution</p>
          <h3>Balanced coverage</h3>
          <div class="split-meter">
            <div class="split-meter__bar">
              <span style="width:${distribution.bridePct}%; background:#24554A;"></span>
              <span style="width:${distribution.groomPct}%; background:#B89156;"></span>
              <span style="width:${distribution.otherPct}%; background:#B56B63;"></span>
            </div>
            <div class="split-meter__legend">
              ${legendRow("Bride", distribution.bride, distribution.bridePct)}
              ${legendRow("Groom", distribution.groom, distribution.groomPct)}
              ${legendRow("Other / Both / Family", distribution.other, distribution.otherPct)}
            </div>
          </div>
        </article>
      </section>

      <section class="overview-support">
        <article class="attention-card">
          <p class="da3wa-eyebrow">Attention required</p>
          <h3>What needs intervention</h3>
          <div class="attention-list">
            ${attention
              .map(
                (item) => `
                  <div class="attention-item">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(item.description)}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
        </article>

        <article class="activity-card">
          <p class="da3wa-eyebrow">Recent activity</p>
          <h3>Latest movement</h3>
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
                : `<div class="attention-item"><strong>No recent activity yet</strong><span>Live RSVP, check-in, and reminder timestamps will surface here.</span></div>`
            }
          </div>
        </article>

        <article class="quick-actions">
          <p class="da3wa-eyebrow">Quick actions</p>
          <h3>Common planner tasks</h3>
          <div class="quick-actions__grid">
            ${quickAction("Add guest", "Create a new invitee with the basic organizer details.", "open-add-guest", !can("canEditGuests"))}
            ${quickAction("Open seating planner", "Jump into table arrangement and seat assignment mode.", "nav-seating")}
            ${quickAction("Export guest list", "Download the full guest roster for coordination and vendors.", "export-all", !can("canExport"))}
            ${quickAction("Copy invitation base", "Share the public invitation pattern with the team.", "copy-invitation-base")}
            ${quickAction("Open check-in console", "Launch the hostess flow with permission-aware access.", "open-checkin")}
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
  const anySelectedVisible = guests.some((guest) =>
    state.selectedGuestIds.includes(guest.id),
  );

  elements.pageContent.innerHTML = `
    <section class="guest-page">
      <article class="guest-toolbar">
        <div class="guest-toolbar__filters">
          <div class="guest-toolbar__controls">
            <input class="da3wa-input guest-toolbar__search" type="search" placeholder="Search name or phone" value="${escapeAttribute(state.guestFilters.search)}" data-guest-search />
            ${selectInput("rsvp", state.guestFilters.rsvp, [
              ["all", "All RSVP"],
              ["confirmed", "Confirmed"],
              ["pending", "Pending"],
              ["declined", "Declined"],
            ])}
            ${selectInput("side", state.guestFilters.side, [
              ["all", "All Sides"],
              ["bride", "Bride"],
              ["groom", "Groom"],
              ["family", "Family"],
              ["both", "Both sides"],
            ])}
          </div>
          <span class="pill">${guests.length} result${guests.length === 1 ? "" : "s"}</span>
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

      ${
        !guests.length
          ? `<div class="da3wa-empty">No guests match the current search and filters.</div>`
          : `
            <article class="da3wa-table guest-table-wrap">
              <table class="guest-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" data-guest-select-all ${allVisibleGuestsSelected(guests) ? "checked" : ""} aria-label="Select all visible guests" /></th>
                    <th>Guest</th>
                    <th>Phone</th>
                    <th>Additional guests</th>
                    <th>Side</th>
                    <th>RSVP</th>
                    <th>Reservation</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${visibleGuests.map((guest) => renderGuestRow(guest)).join("")}
                </tbody>
              </table>
            </article>
            <article class="guest-page-controls" aria-label="Guest directory pages">
              <button class="da3wa-button da3wa-button--secondary" type="button" data-action="guest-page-prev" ${state.guestPageIndex === 0 ? 'disabled aria-disabled="true"' : ""}>←</button>
              <span>Showing ${pageStart + 1}-${Math.min(pageStart + guestDirectoryPageSize, guests.length)} of ${guests.length}</span>
              <button class="da3wa-button da3wa-button--secondary" type="button" data-action="guest-page-next" ${state.guestPageIndex >= totalGuestPages - 1 ? 'disabled aria-disabled="true"' : ""}>→</button>
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
  if (state.loadingTables) {
    elements.pageContent.innerHTML =
      '<section class="seating-page"><div class="da3wa-skeleton" aria-hidden="true"></div></section>';
    return;
  }

  const selectedTable = getSelectedTable();
  const selectedSeat = getSelectedSeat();
  const seatingStats = calculateDashboardStats(state.guests, state.tables);
  const sideStats = calculateSideStats(state.guests, state.tables);
  const isSaving = state.saveState === "saving";
  const assignmentStatusPanel = state.assignmentSession
    ? renderAssignmentPanelHint()
    : renderAssignmentStatusPanel(selectedSeat);

  elements.pageContent.innerHTML = `
    <section class="seating-page">
      <article class="planner-toolbar">
        <div class="planner-toolbar__cluster">
          <div class="planner-toggle" role="tablist" aria-label="Seating mode">
            <button class="${state.seatingMode === "layout" ? "is-active" : ""}" type="button" data-action="set-seating-mode" data-mode="layout">Layout mode</button>
            <button class="${state.seatingMode === "assignment" ? "is-active" : ""}" type="button" data-action="set-seating-mode" data-mode="assignment">Assignment mode</button>
          </div>
        </div>
        <div class="planner-toolbar__actions">
          <div class="planner-zoom-stack">
            <div class="planner-zoom-controls" aria-label="Planner zoom controls">
              ${actionButton("Zoom out", "planner-zoom-out")}
              ${actionButton("Zoom in", "planner-zoom-in")}
              <span class="pill">${Math.round(state.plannerZoom * 100)}%</span>
            </div>
            <div class="planner-zoom-stats" aria-label="Planner status">
              <span class="pill">${state.tables.length} tables</span>
              <span class="pill">${seatingStats.totalSeats} seats</span>
              <span class="pill">${seatingStats.total} guests</span>
              <span class="pill">${seatingStats.unassignedGuests} guest parties need seats</span>
              <span class="pill pill--groom">Groom fully seated ${sideStats.groom.seated}/${sideStats.groom.confirmed}</span>
              <span class="pill pill--bride">Bride fully seated ${sideStats.bride.seated}/${sideStats.bride.confirmed}</span>
              <button class="planner-save-status ${isSaving ? "is-saving" : "is-saved"}" type="button" disabled aria-live="polite" aria-label="${isSaving ? "Saving seating changes" : "All seating changes saved"}">
                <span aria-hidden="true">${isSaving ? "↻" : "✓"}</span>${isSaving ? "Saving…" : "Saved"}
              </button>
            </div>
          </div>
          ${actionButton("Add table", "open-add-table", !can("canEditSeating"), "primary")}
        </div>
      </article>

      <div class="planner-layout">
        <article class="planner-canvas-shell">
          <div class="planner-canvas__header">
            <div>
              <p class="da3wa-eyebrow">Venue canvas</p>
              <h3 class="planner-panel__title">${state.seatingMode === "layout" ? "Ballroom layout builder" : "Seat assignment workspace"}</h3>
            </div>
            <div class="guest-toolbar__summary">
              <span class="pill">${state.seatingMode === "layout" ? "Drag tables to reposition" : "Select chairs to assign guests · drag tables to reposition"}</span>
            </div>
          </div>
          <div class="planner-canvas" id="plannerCanvas">
            <div class="planner-canvas__floor"></div>
            ${state.hallObjects.map((item) => renderHallObject(item)).join("")}
            ${state.tables.length ? state.tables.map((table) => renderPlannerTable(table)).join("") : `<div class="da3wa-empty">No tables yet. Create your first table to start mapping the hall.</div>`}
          </div>
          ${state.assignmentSession ? `<div class="assignment-dock">${renderAssignmentControls()}</div>` : ""}
        </article>

        <div class="planner-panel__stack">
          <article class="planner-panel">
            ${
              selectedTable
                ? renderTableInspector(selectedTable)
                : `<div class="da3wa-empty">Select a table on the canvas to inspect its dimensions, occupancy, and actions.</div>`
            }
          </article>

          ${
            state.seatingMode === "layout"
              ? `<article class="planner-panel">
                  <div class="planner-panel__header">
                    <div>
                      <p class="da3wa-eyebrow">Planner library</p>
                      <h3 class="planner-panel__title">Tables</h3>
                    </div>
                  </div>
                  ${renderLayoutLibrary()}
                </article>`
              : ""
          }

          ${assignmentStatusPanel ? `<article class="planner-panel">${assignmentStatusPanel}</article>` : ""}
        </div>
      </div>
    </section>
  `;

  document
    .getElementById("plannerCanvas")
    ?.addEventListener("pointerdown", handlePlannerPointerDown, {
      once: false,
    });
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
  const base = new URL(window.location.href);
  const dashboardLink = new URL(
    `dashboard.html?wedding=${encodeURIComponent(state.weddingId)}`,
    base,
  ).toString();
  const hostessLink = new URL(
    `checkin.html?wedding=${encodeURIComponent(state.weddingId)}`,
    base,
  ).toString();
  const invitationBase = new URL(
    `index.html?wedding=${encodeURIComponent(state.weddingId)}&guest={guestToken}`,
    base,
  ).toString();
  const previewGuest = state.guests[0];
  const previewInvitation = buildInviteLink(
    previewGuest?.guestToken || "{guestToken}",
  );

  const cards = [
    {
      title: "Guest invitation base",
      description:
        "Template for personalized invitation links. Replace `{guestToken}` with the guest's secure token.",
      value: invitationBase,
      copyAction: "copy-invitation-base",
      openAction: previewGuest ? "open-invitation-preview" : "",
    },
    {
      title: "Dashboard link",
      description:
        "Use this for planners and authorized event staff. Keep it internal.",
      value: dashboardLink,
      copyAction: "copy-dashboard",
      openAction: "open-dashboard",
    },
    {
      title: "Check-in link",
      description:
        "Direct venue staff to the permission-gated hostess check-in page.",
      value: hostessLink,
      copyAction: "copy-checkin",
      openAction: "open-checkin",
    },
    {
      title: "Invitation preview",
      description:
        "Open the current invitation experience with the first available guest preview link.",
      value: previewInvitation,
      copyAction: "copy-preview",
      openAction: "open-invitation-preview",
    },
  ];

  elements.pageContent.innerHTML = `
    <section class="share-page">
      ${renderSeatingAccessCard()}
      ${renderSenderCard()}
      ${renderSideViewCard()}
      <div class="share-grid">
        ${cards
          .map(
            (card) => `
              <article class="share-card">
                <p class="da3wa-eyebrow">Useful link</p>
                <h3>${escapeHtml(card.title)}</h3>
                <p>${escapeHtml(card.description)}</p>
                <code>${escapeHtml(card.value)}</code>
                <div class="share-card__actions">
                  ${actionButton("Copy", card.copyAction)}
                  ${card.openAction ? actionButton("Open", card.openAction, false, "secondary") : ""}
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
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
      <p>Each link opens a read-only page showing just that side's numbers and seating plan: who is coming, who declined, invitations sent, and where everyone sits. Share it with the groom's or bride's family so they can follow along without seeing the full dashboard.</p>
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
      <p class="da3wa-eyebrow">WhatsApp sender</p>
      <h3>Send invitations from the couple's own phones</h3>
      <p>Each link opens a ready-made sending page listing the guests with a one-tap WhatsApp button per guest. Every list now matches the corresponding guest-side count exactly, so each guest appears in one side list only.</p>
      <div class="sender-options">
        ${senderOption("Groom side", "groom")}
        ${senderOption("Bride side", "bride")}
        ${familyCount ? senderOption("Family", "family", "family guests appear only here and in All guests") : ""}
        ${senderOption("All guests", "all")}
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
      "XLSX / CSV",
      "export-all",
    ),
    exportCard(
      "Confirmed",
      "Guests with accepted RSVP status.",
      "XLSX / CSV",
      "export-confirmed",
    ),
    exportCard(
      "Pending",
      "Guests still awaiting a response.",
      "XLSX / CSV",
      "export-pending",
    ),
    exportCard(
      "Declined",
      "Guests who cannot attend.",
      "XLSX / CSV",
      "export-declined",
    ),
    exportCard(
      "Checked in",
      "Guests who have arrived at the venue.",
      "XLSX / CSV",
      "export-checkedIn",
    ),
    exportCard(
      "Not checked in",
      "Guests still expected onsite.",
      "XLSX / CSV",
      "export-notCheckedIn",
    ),
    exportCard(
      "Table assignments",
      "Roster sorted by table and seat placement.",
      "XLSX / CSV",
      "export-tables",
    ),
    exportCard(
      "Bride side",
      "Filtered list of bride-side guests.",
      "XLSX / CSV",
      "export-bride",
    ),
    exportCard(
      "Groom side",
      "Filtered list of groom-side guests.",
      "XLSX / CSV",
      "export-groom",
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

function renderSideOverviewCard(title, sideKey, bucket) {
  return `
    <article class="analytics-card side-card side-card--${escapeAttribute(sideKey)}">
      <header class="side-card__head">
        <div>
          <p class="da3wa-eyebrow">${escapeHtml(title)}</p>
          <h3>${escapeHtml(String(bucket.confirmedSeats))} attending</h3>
        </div>
        <span class="pill">${escapeHtml(String(bucket.guestCount))} invited · ${escapeHtml(String(bucket.partyTotal))} seats</span>
      </header>
      <div class="side-card__stats">
        <div class="side-stat"><strong>${escapeHtml(String(bucket.confirmed))}</strong><span>Confirmed</span></div>
        <div class="side-stat"><strong>${escapeHtml(String(bucket.pending))}</strong><span>Pending</span></div>
        <div class="side-stat"><strong>${escapeHtml(String(bucket.declined))}</strong><span>Not coming</span></div>
        <div class="side-stat"><strong>${escapeHtml(String(bucket.seated))}/${escapeHtml(String(bucket.confirmed))}</strong><span>Seated</span></div>
      </div>
      <div class="progress-stack">
        ${progressRow("Confirmed", bucket.confirmed, bucket.guestCount, "sage")}
        ${progressRow("Pending", bucket.pending, bucket.guestCount, "amber")}
        ${progressRow("Not coming", bucket.declined, bucket.guestCount, "rose")}
      </div>
    </article>
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

function legendRow(label, value, percent) {
  return `
    <div class="legend-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))} · ${percent}%</strong>
    </div>
  `;
}

function quickAction(title, description, action, disabled = false) {
  return `
    <button class="quick-action ${disabled ? "is-disabled" : ""}" type="button" data-action="${escapeAttribute(action)}" ${disabled ? 'aria-disabled="true"' : ""}>
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
    </button>
  `;
}

function renderGuestRow(guest) {
  const inviteLink = buildInviteLink(guest.guestToken);
  const qrLink = guest.qrCodeValue || buildCheckinLink(guest.guestToken);
  const isSelected = state.selectedGuestIds.includes(guest.id);
  const menuOpen = state.activeGuestMenu?.guestId === guest.id;

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
      <td>${badge(guest.side || "other", "plain")}</td>
      <td>${renderGuestRsvpSelect(guest)}</td>
      <td>${renderReservationReadinessBadge(guest)}</td>
      <td>
        <div class="guest-row__actions">
          ${renderGuestInlineActions(guest)}
          <button class="guest-row__menu-toggle" id="guest-menu-trigger-${escapeAttribute(guest.id)}" type="button" data-action="toggle-guest-menu" data-guest-id="${guest.id}" aria-label="Open guest actions" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}" aria-controls="guestActionMenu">⋯</button>
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
        <span>Side: ${escapeHtml(guest.side || "other")}</span>
        <span>${renderReservationReadinessBadge(guest)}</span>
      </div>
      <div class="guest-card__actions">
        ${actionButton("Edit", "edit-guest", !can("canEditGuests"), "secondary", guest.id)}
        ${actionButton("Copy link", "copy-guest-invite", false, "ghost", guest.id)}
        ${renderGuestInlineActions(guest)}
      </div>
    </article>
  `;
}

function renderSeatingAccessCard() {
  if (!canManageSeatingAccess()) return "";
  const loginLink = seatingAccountLoginLink();
  return `
    <article class="share-card share-card--sender">
      <p class="da3wa-eyebrow">Wedding Seating Access</p>
      <h3>Bride &amp; Groom seating sign-in</h3>
      <p>Share this same link with the Bride and Groom. After they sign in with their own account, they are taken directly to the mobile-friendly Seating Editor.</p>
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
  return new URL("dashboard-login.html?seatingOnly=1", window.location.href).toString();
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
      "Only the wedding owner can manage seating editor access.",
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
  const reminderDisabled = !buildWhatsAppReminderLink(guest);
  return `
    <div class="guest-inline-actions" aria-label="Quick actions for ${escapeAttribute(guest.fullName || "guest")}">
      <button class="guest-quick-button" type="button" data-action="open-reminder" data-guest-id="${escapeAttribute(guest.id)}" ${reminderDisabled ? 'disabled aria-disabled="true"' : ""}>WhatsApp</button>
      <button class="guest-quick-button" type="button" data-action="copy-guest-qr" data-guest-id="${escapeAttribute(guest.id)}">QR</button>
    </div>
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
  const transform = `translate(-50%, -50%) scale(${state.plannerZoom}) rotate(${Number(table.rotation || 0)}deg)`;
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
            <strong>${escapeHtml(table.label || table.name)}</strong>
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
  const icon = item.type === "stage" ? renderStageIcon() : renderEntranceIcon();
  return `
    <div
      class="hall-object hall-object--${escapeAttribute(item.type)}"
      style="left:${item.x}%; top:${item.y}%;"
      title="Drag ${escapeAttribute(item.label)}"
      data-hall-object-id="${escapeAttribute(item.id)}"
    >
      ${icon}
      <span>${escapeHtml(item.label)}</span>
    </div>
  `;
}

function renderStageIcon() {
  return `
    <span class="hall-object__icon hall-object__icon--stage" aria-hidden="true">
      <span></span>
    </span>
  `;
}

function renderEntranceIcon() {
  return `
    <span class="hall-object__icon hall-object__icon--entrance" aria-hidden="true">
      <span></span>
    </span>
  `;
}

function renderTableInspector(table) {
  const assignments = getTableAssignments(table.id);
  const capacity = Number(table.seatCount || table.capacity || 0);
  const assignedGuests = assignments
    .map((assignment) => ({
      assignment,
      guest: state.guests.find((item) => item.id === assignment.guestId),
    }))
    .sort(
      (left, right) =>
        Number(left.assignment.seatNumber || 0) -
        Number(right.assignment.seatNumber || 0),
    );
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
      ${actionButton("Edit", "edit-table", !can("canEditSeating"), "secondary", table.id)}
      ${actionButton("Duplicate", "duplicate-table", !can("canEditSeating"), "secondary", table.id)}
      ${actionButton("Delete", "delete-table", !can("canEditSeating"), "danger", table.id)}
    </div>
    <div class="planner-assigned-guests">
      <div class="planner-panel__header">
        <div>
          <p class="da3wa-eyebrow">Assigned guests</p>
          <h3 class="planner-panel__title">${assignedGuests.length} of ${capacity} seats filled</h3>
        </div>
      </div>
      <div class="planner-guest-list">
        ${
          assignedGuests.length
            ? assignedGuests
                .map(
                  ({ assignment, guest }) => `
                  <div class="planner-guest-pill">
                    <strong>${escapeHtml(guest?.fullName || "Guest")}</strong>
                    <small>Seat ${escapeHtml(String(assignment.seatNumber || "—"))} · ${escapeHtml(assignment.label || "Guest")}</small>
                  </div>
                `,
                )
                .join("")
            : '<div class="da3wa-empty">No guests have been assigned to this table yet.</div>'
        }
      </div>
    </div>
  `;
}
function renderLayoutLibrary() {
  const tables = state.tables
    .map((table) => {
      const occupied = getTableAssignments(table.id).length;
      return `
        <button class="planner-table-list__button ${table.id === state.selectedTableId ? "is-selected" : ""}" type="button" data-action="select-table" data-table-id="${table.id}">
          <strong>${escapeHtml(table.name)}</strong>
          <small>${escapeHtml(table.label || prettifyShape(table.shape))} · ${occupied}/${Number(table.seatCount || 0)} seated</small>
        </button>
      `;
    })
    .join("");

  const objects = state.hallObjects
    .map(
      (item) => `
        <div class="planner-object-item">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(prettifyShape(item.type))} marker · local demo object</small>
        </div>
      `,
    )
    .join("");

  return `
    <div class="planner-table-list">${tables || '<div class="da3wa-empty">No tables yet.</div>'}</div>
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
      <label>
        <span>Side filter</span>
        <select class="da3wa-input" data-library-filter="side">
          <option value="all" ${state.libraryFilters.side === "all" ? "selected" : ""}>All sides</option>
          <option value="bride" ${state.libraryFilters.side === "bride" ? "selected" : ""}>Bride</option>
          <option value="groom" ${state.libraryFilters.side === "groom" ? "selected" : ""}>Groom</option>
          <option value="family" ${state.libraryFilters.side === "family" ? "selected" : ""}>Family</option>
          <option value="both" ${state.libraryFilters.side === "both" ? "selected" : ""}>Both sides</option>
        </select>
      </label>
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
                    <small>${escapeHtml(guest.side || "other")} · ${escapeHtml(guest.rsvpStatus || "pending")} · ${escapeHtml(guest.notes || "No notes")}</small>
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
  if (state.seatingMode !== "assignment") {
    return "";
  }

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
  return `
    <div class="assignment-dock__main">
      <div>
        <p class="da3wa-eyebrow">Assignment in progress</p>
        <h3 class="planner-panel__title">${escapeHtml(guest?.fullName || "Guest party")}</h3>
        <p class="planner-note">Select one or more chairs on the map. Amber chairs are temporary until you complete the assignment.</p>
      </div>
      ${badge(`${selectedCount} of ${required}`, selectedCount === required ? "confirmed" : "pending")}
    </div>
    <div class="assignment-progress">
      <strong>${selectedCount} of ${required} chairs selected</strong>
      <span>${escapeHtml(getSelectedChairSummary(session.selectedChairs) || "No chairs selected yet")}</span>
    </div>
    ${state.modalError ? `<div class="planner-warning-list"><span class="warning-chip">${escapeHtml(state.modalError)}</span></div>` : ""}
    <div class="assignment-dock__actions">
      <button class="da3wa-button da3wa-button--secondary" type="button" data-action="cancel-assignment">Cancel</button>
      <button class="da3wa-button da3wa-button--primary ${!canComplete ? "is-disabled" : ""}" type="button" data-action="complete-assignment" ${!canComplete ? 'disabled aria-disabled="true"' : ""}>Complete assignment</button>
    </div>
  `;
}

function renderAssignmentPanelHint() {
  return `
    <div class="planner-panel__header">
      <div>
        <p class="da3wa-eyebrow">Assignment controls</p>
        <h3 class="planner-panel__title">Below the map</h3>
      </div>
    </div>
    <p class="planner-note">Use the buttons beneath the seating map when you are ready to save or cancel the move.</p>
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
        <strong>${escapeHtml(selectedSeat.table.label || selectedSeat.table.name)} · Chair ${escapeHtml(String(selectedSeat.chair.seatNumber))}</strong>
      </div>
    </div>

    <div class="seat-assignment__controls">
      <input class="da3wa-input" type="search" placeholder="Search guest, Arabic name, side, RSVP, or phone" value="${escapeAttribute(state.guestAssignmentSearch)}" data-seat-search />
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
                    <small>${escapeHtml(guest.side || "other")} · ${escapeHtml(guest.rsvpStatus || "pending")} · ${existingSeat ? "Move from another seat" : "Assign here"}</small>
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

function exportCard(title, description, format, action) {
  return `
    <article class="export-card">
      <p class="da3wa-eyebrow">Export package</p>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      <code>${escapeHtml(format)}</code>
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
    ${menuItem("Edit guest", "edit-guest", guest.id)}
    ${menuItem("Copy invitation link", "copy-guest-invite", guest.id)}
    ${menuItem("Mark checked in", "toggle-checkin", guest.id, !can("canCheckIn"))}
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
  return `
    <select class="da3wa-input" data-guest-filter="${escapeAttribute(key)}">
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
    case "refresh-dashboard":
      if (state.mode === "live") {
        await bootstrapDashboard();
      } else {
        renderAll();
      }
      showToast("Dashboard refreshed.", "success");
      return;
    case "nav-seating":
      switchView("seating");
      return;
    case "open-seating-for-guest":
      elements.missingSeatsModal?.close();
      state.activeView = "seating";
      state.seatingMode = "assignment";
      state.activePartyGuestId = dataset.guestId || "";
      state.selectedSeatId = "";
      if (state.activePartyGuestId) {
        const firstAssignment = getGuestAssignedSeats(
          state.activePartyGuestId,
        )[0];
        state.selectedTableId =
          firstAssignment?.tableId ||
          state.selectedTableId ||
          state.tables[0]?.id ||
          "";
      }
      renderAll();
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
        const trigger = document.getElementById(
          `guest-menu-trigger-${dataset.guestId}`,
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
    case "set-seating-mode":
      state.seatingMode = dataset.mode;
      if (state.seatingMode !== "assignment") {
        cancelAssignmentSession();
      }
      renderActiveView();
      return;
    case "planner-zoom-in":
      setPlannerZoom(state.plannerZoom + 0.1);
      return;
    case "planner-zoom-out":
      setPlannerZoom(state.plannerZoom - 0.1);
      return;
    case "load-test-guests":
      loadSeatingTestGuests();
      return;
    case "select-table":
      state.selectedTableId = dataset.tableId;
      renderActiveView();
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
      if (state.seatingMode === "layout") {
        state.seatingMode = "assignment";
      }
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
      title: `${confirmedWithoutTables} confirmed guest${confirmedWithoutTables === 1 ? "" : "s"} without tables`,
      description: "These guests accepted but still need a final placement.",
    },
    {
      title: `${pendingGuests} pending RSVP${pendingGuests === 1 ? "" : "s"}`,
      description: "Useful for reminder follow-up and late seating decisions.",
    },
    {
      title: `${overCapacity} table${overCapacity === 1 ? "" : "s"} over capacity`,
      description:
        "Check manual edits or seat conflicts that exceed the available chairs.",
    },
    {
      title: `${incompleteInfo} guest profile${incompleteInfo === 1 ? "" : "s"} incomplete`,
      description:
        "Phone or profile details are missing and may block reminders or coordination.",
    },
    {
      title: `${conflicts} declined guest${conflicts === 1 ? "" : "s"} still seated`,
      description: "Useful conflict warning before finalizing the floor plan.",
    },
  ];
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
  return items.sort((a, b) => b.sortKey - a.sortKey).slice(0, 6);
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

function calculateSideDistribution(guests) {
  const bride = guests.filter((guest) => guest.side === "bride").length;
  const groom = guests.filter((guest) => guest.side === "groom").length;
  const other = guests.filter(
    (guest) => !["bride", "groom"].includes(guest.side),
  ).length;
  const total = Math.max(guests.length, 1);
  return {
    bride,
    groom,
    other,
    bridePct: percentage(bride, total),
    groomPct: percentage(groom, total),
    otherPct: percentage(other, total),
  };
}

function getFilteredGuests() {
  const search = state.guestFilters.search.trim().toLowerCase();
  const sorted = [...state.guests].filter((guest) => {
    const matchesSearch =
      !search ||
      [guest.fullName, guest.fullNameAr, guest.phone].some((value) =>
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
  const guestId = assignment?.guestId || chair?.guestId || "";
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
          ? { ...assignment, chairId: chair.id, tableName: table.name, chair }
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
  return getAllAssignments(tables).filter(
    (assignment) => assignment.guestId === guestId,
  );
}

function countAssignedSeats(tables = state.tables) {
  return getAllAssignments(tables).length;
}

function getGuestRemainingSeats(guest, tables = state.tables) {
  return Math.max(
    0,
    getPartySize(guest) - getGuestAssignedSeats(guest.id, tables).length,
  );
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
  elements.guestForm.side.value = guest?.side || "bride";
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
    side: normalizeGuestSide(elements.guestForm.side.value),
    additionalGuests,
    updatedAt: serverTimestamp(),
  };
  const createPayload = {
    ...ownedPayload,
    fullNameAr: "",
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
    fullNameAr: guest.fullNameAr || "",
    side: normalizeGuestSide(guest.side),
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
  "fullNameAr",
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
  const side = normalizeGuestSide(elements.bulkAddForm.side.value);
  const payloads = entries.map((entry) => {
    const token = generateGuestToken();
    return {
      fullName: entry.fullName,
      fullNameAr: "",
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
          [entry.fullName, entry.phone, entry.additionalGuests || ""]
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
  if (!can("canEditSeating")) {
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
  elements.tableForm.name.value = table?.name || "";
  elements.tableForm.label.value = table?.label || "";
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
  if (!can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  const existingTable = state.tables.find(
    (table) => table.id === state.selectedTableId,
  );
  const payload = createPlannerTable({
    id: state.selectedTableId || createId("table"),
    name: elements.tableForm.name.value.trim(),
    label: elements.tableForm.label.value.trim(),
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
  if (!can("canEditSeating")) {
    showToast("Your role does not allow seating edits.", "error");
    return;
  }

  const duplicated = createPlannerTable({
    ...table,
    id: createId("table"),
    name: `${table.name} Copy`,
    label: `${table.label || table.name} Copy`,
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
  if (!can("canEditSeating")) {
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
  if (!can("canEditSeating")) {
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
  state.plannerZoom = clamp(nextZoom, 0.7, 1.45);
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
  const tableNode = event.target.closest("[data-table-drag-id]");
  const objectNode = event.target.closest("[data-hall-object-id]");
  const seatNode = event.target.closest("[data-action='select-seat']");
  if ((!tableNode && !objectNode) || seatNode) {
    return;
  }

  // Tables can be repositioned while assigning seats. Hall objects stay in
  // layout mode so assignment interactions remain focused on the chairs.
  if (state.seatingMode !== "layout" && !tableNode) {
    return;
  }

  if (objectNode) {
    const objectId = objectNode.dataset.hallObjectId;
    const hallObject = state.hallObjects.find((item) => item.id === objectId);
    if (!hallObject) {
      return;
    }
    state.dragState = {
      type: "hall-object",
      objectId,
      startX: event.clientX,
      startY: event.clientY,
      originalX: Number(hallObject.x || 0),
      originalY: Number(hallObject.y || 0),
    };
    objectNode.setPointerCapture?.(event.pointerId);
    return;
  }

  const tableId = tableNode.dataset.tableDragId;
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) {
    return;
  }

  state.selectedTableId = tableId;
  state.dragState = {
    type: "table",
    tableId,
    startX: event.clientX,
    startY: event.clientY,
    originalX: Number(table.x || 0),
    originalY: Number(table.y || 0),
  };
  tableNode.setPointerCapture?.(event.pointerId);
}

function handlePlannerPointerMove(event) {
  if (!state.dragState) {
    return;
  }

  const canvas = document.getElementById("plannerCanvas");
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const dx = ((event.clientX - state.dragState.startX) / rect.width) * 100;
  const dy = ((event.clientY - state.dragState.startY) / rect.height) * 100;
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
  renderActiveView();
}

async function handlePlannerPointerUp() {
  if (!state.dragState) {
    return;
  }

  const { type, tableId, objectId, moved, originalX, originalY } =
    state.dragState;
  state.dragState = null;

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
      renderActiveView();
      return;
    }
    if (!can("canEditSeating")) {
      state.hallObjects = state.hallObjects.map((item) =>
        item.id === objectId ? { ...item, x: originalX, y: originalY } : item,
      );
      renderActiveView();
      showToast("Your role does not allow layout edits.", "error");
      return;
    }
    if (state.mode === "demo") {
      persistDemoDashboardState();
      return;
    }
    setSaveState("saving");
    try {
      await updateDoc(doc(state.services.db, "weddings", state.weddingId), {
        hallObjects: state.hallObjects,
        updatedAt: serverTimestamp(),
      });
      setSaveState("saved");
    } catch (error) {
      console.error(error);
      setSaveState("saved");
      showToast("Stage or entrance position could not be saved.", "error");
    }
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
    return;
  }

  if (!can("canEditSeating")) {
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
  } catch (error) {
    console.error(error);
    setSaveState("saved");
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
  };
  openCenteredModal(
    elements.assignmentModal,
    renderAssignmentModal,
    "[data-seat-search]",
  );
  renderActiveView();
}

function renderAssignmentModal() {
  if (!elements.assignmentContent || !state.assignmentSession) {
    return;
  }
  const session = state.assignmentSession;
  const guest = session.guestId
    ? state.guests.find((item) => item.id === session.guestId)
    : null;
  const candidates = getSeatCandidates(session.guestId).filter(
    (item) => getGuestRemainingSeats(item) > 0 || item.id === session.guestId,
  );
  const filtered = candidates.filter((item) => {
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
          <strong>${selectedCount} of ${session.requiredSeats} chairs selected</strong>
          <span>${escapeHtml(getSelectedChairSummary(session.selectedChairs))}</span>
        </div>
        ${state.modalError ? `<div class="planner-warning-list"><span class="warning-chip">${escapeHtml(state.modalError)}</span></div>` : ""}
        <p class="planner-note">Use the canvas behind this modal to add or remove empty chairs. You can save a partial party assignment and finish the remaining seats later.</p>
      `
          : `
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
        ${guest ? actionButton("Complete assignment", "complete-assignment", selectedCount < 1 || Boolean(state.activeModalOperation), "primary") : ""}
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
      <span>${escapeHtml(guest.side || "Side not set")} - party of ${partySize}</span>
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
    showToast("Party assignment saved.", "success");
  } catch (error) {
    console.error(error);
    state.activeModalOperation = "";
    state.modalError = error.message || "Assignment failed.";
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
    nextTables.forEach((table) => {
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
    console.error(error);
    state.activeModalOperation = "";
    state.modalError =
      error.message ||
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
    console.error(error);
    state.activeModalOperation = "";
    state.modalError = error.message || "Seat unassign failed.";
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
    console.error(error);
    state.activeModalOperation = "";
    state.modalError = error.message || "Move party failed.";
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
    console.error(error);
    state.activeModalOperation = "";
    setSaveState("saved");
    renderAll();
    showToast(
      error.message ||
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
    { includeSeating: type === "tables" },
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
    name: table.name || "New Table",
    label: table.label || table.name || "Table",
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
        guest.fullNameAr,
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

function hydrateHallObjects(savedObjects) {
  const savedById = new Map(
    Array.isArray(savedObjects)
      ? savedObjects.map((item) => [item.id, item])
      : [],
  );
  return createHallObjects().map((item) => ({
    ...item,
    ...(savedById.get(item.id) || {}),
  }));
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
  const couple = `${state.wedding?.brideName || "Bride"} & ${state.wedding?.groomName || "Groom"}`;
  const message = `Hello ${guest.fullName || "Guest"}, this is a kind reminder to confirm your attendance for the wedding of ${couple}.\nPlease open your personal invitation here:\n${buildInviteLink(guest.guestToken)}`;
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
// shared guests from inflating the Groom or Bride invitation counts.
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
  const guests = getSenderGuests(side).map((guest) => ({
    n: guest.fullName || "",
    a: guest.fullNameAr || "",
    p: normalizeWhatsAppPhone(guest.phone),
    s: guest.side || "",
    t: guest.guestToken || "",
  }));
  const payload = {
    v: 1,
    w: state.weddingId,
    c: state.wedding?.coupleName || "",
    side,
    g: guests,
  };
  return new URL(
    `send.html#data=${encodeSenderPayload(payload)}`,
    window.location.href,
  ).toString();
}

function buildSideViewLink(side) {
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

function encodeSenderPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
