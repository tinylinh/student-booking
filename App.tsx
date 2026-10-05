import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  ImageSourcePropType,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import { NavigationContainer, useNavigation } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create } from "zustand";
import { supabase, vietQrConfig } from "./src/lib/supabase";
import {
  cancelBookingHold,
  getBookingRooms,
  getMyBookings,
  getRoomAvailability,
  holdBookingResources,
  submitBookingTransfer,
} from "./src/lib/bookingApi";

WebBrowser.maybeCompleteAuthSession();

type Room = {
  id: string;
  name: string;
  building: string;
  seats: number;
  status: "Available" | "Occupied";
  image: ImageSourcePropType;
  floor: string;
  facilities: string[];
  category: "Meeting room" | "Library" | "Study room";
  bookingMode: "whole-room" | "seat";
  hourlyRate: number;
};

const ROOMS: Room[] = [
  {
    id: "meeting-10",
    name: "Meeting Room 10",
    building: "Meeting Center",
    seats: 10,
    status: "Available",
    image: require("./meeting room.jpg"),
    floor: "1st floor",
    facilities: ["Wi-Fi", "Display", "Air conditioning"],
    category: "Meeting room",
    bookingMode: "whole-room",
    hourlyRate: 80000,
  },
  {
    id: "meeting-20",
    name: "Meeting Room 20",
    building: "Meeting Center",
    seats: 20,
    status: "Available",
    image: require("./meeting room.jpg"),
    floor: "2nd floor",
    facilities: ["Wi-Fi", "Projector", "Air conditioning"],
    category: "Meeting room",
    bookingMode: "whole-room",
    hourlyRate: 120000,
  },
  {
    id: "meeting-40",
    name: "Meeting Room 40",
    building: "Meeting Center",
    seats: 40,
    status: "Available",
    image: require("./meeting room.jpg"),
    floor: "3rd floor",
    facilities: ["Wi-Fi", "Projector", "Video conferencing"],
    category: "Meeting room",
    bookingMode: "whole-room",
    hourlyRate: 200000,
  },
  {
    id: "library-main",
    name: "Library Reading Hall",
    building: "Main Library",
    seats: 36,
    status: "Available",
    image: require("./phòng thư viện.jpg"),
    floor: "2nd floor",
    facilities: ["Wi-Fi", "Power outlets", "Quiet zone"],
    category: "Library",
    bookingMode: "seat",
    hourlyRate: 5000,
  },
  {
    id: "study-hall",
    name: "Quiet Study Hall",
    building: "Learning Center",
    seats: 24,
    status: "Available",
    image: require("./phòng tự học.jpg"),
    floor: "1st floor",
    facilities: ["Wi-Fi", "Power outlets", "Silent zone"],
    category: "Study room",
    bookingMode: "seat",
    hourlyRate: 8000,
  },
];

type Booking = {
  id: string;
  paymentReference: string;
  room: Room;
  date: string;
  startTime: string;
  durationHours: number;
  seatIds: string[];
  totalPrice: number;
  paymentStatus: "awaiting-payment" | "awaiting-review" | "confirmed" | "cancelled" | "expired";
};

type SeatReservation = {
  roomId: string;
  date: string;
  time: string;
  seatId: string;
  status: "held" | "booked";
  ownerId: string;
  expiresAt?: number;
};

type BookingStore = {
  bookings: Booking[];
  reservations: SeatReservation[];
  setRoomAvailability: (roomId: string, date: string, reservations: SeatReservation[]) => void;
  setBookings: (bookings: Booking[]) => void;
  upsertBooking: (booking: Booking) => void;
};

const formatTimeRange = (startTime: string, durationHours: number) => {
  const [hours, minutes] = startTime.split(":").map(Number);
  const endHour = String(hours + durationHours).padStart(2, "0");
  return `${startTime}-${endHour}:${String(minutes).padStart(2, "0")}`;
};
const timeRangeOverlaps = (first: string, second: string) => {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const [firstStart, firstEnd] = first.split("-").map(toMinutes);
  const [secondStart, secondEnd] = second.split("-").map(toMinutes);
  return firstStart < secondEnd && secondStart < firstEnd;
};
const formatCurrency = (amount: number) =>
  `${new Intl.NumberFormat("vi-VN").format(amount)} đ`;
const useBookingStore = create<BookingStore>((set) => ({
  bookings: [],
  reservations: [],
  setRoomAvailability: (roomId, date, nextReservations) => set((state) => ({
    reservations: [
      ...state.reservations.filter((item) => item.roomId !== roomId || item.date !== date),
      ...nextReservations,
    ],
  })),
  setBookings: (bookings) => set({ bookings }),
  upsertBooking: (booking) => set((state) => ({
    bookings: [booking, ...state.bookings.filter((item) => item.id !== booking.id)],
  })),
}));

type RootStackParamList = {
  MainTabs: undefined;
  RoomDetail: { room: Room };
  Booking: { room: Room };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

const queryClient = new QueryClient();

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>KL</Text>
      </View>
    </View>
  );
}

function RoomCard({ room }: { room: Room }) {
  const navigation =
    useNavigation<NativeStackScreenProps<RootStackParamList>["navigation"]>();

  return (
    <Pressable
      style={styles.roomCard}
      onPress={() => navigation.navigate("RoomDetail", { room })}
    >
      <View style={styles.roomCardImageWrap}>
        <Image source={room.image} style={styles.roomImage} />
        <View style={styles.roomCategoryPill}>
          <Text style={styles.roomCategoryText}>{room.category}</Text>
        </View>
      </View>
      <View style={styles.roomBody}>
        <View style={styles.rowBetween}>
          <Text style={styles.roomName}>{room.name}</Text>
          <View
            style={[
              styles.statusPill,
              room.status === "Available"
                ? styles.availablePill
                : styles.occupiedPill,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                room.status === "Available"
                  ? styles.availableText
                  : styles.occupiedText,
              ]}
            >
              {room.status}
            </Text>
          </View>
        </View>
        <View style={styles.roomCardMeta}>
          <Ionicons name="location-outline" size={14} color="#8A929F" />
          <Text style={styles.roomLocation}>{room.building} · {room.floor}</Text>
        </View>
        <View style={styles.roomCardFooter}>
          <View>
            <Text style={styles.roomRate}>{formatCurrency(room.hourlyRate)}<Text style={styles.roomRateUnit}> / hr</Text></Text>
            <Text style={styles.roomCapacity}>{room.bookingMode === "whole-room" ? `Entire room · ${room.seats} people` : `${room.seats} reservable seats`}</Text>
          </View>
          <View style={styles.roomCardArrow}><Ionicons name="arrow-forward" size={17} color="#2457F5" /></View>
        </View>
      </View>
    </Pressable>
  );
}

function BrowseRooms() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [roomCatalog, setRoomCatalog] = useState(ROOMS);
  const [catalogError, setCatalogError] = useState("");
  const navigation = useNavigation<NativeStackScreenProps<RootStackParamList>["navigation"]>();

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void getBookingRooms().then((storedRooms) => {
      if (!active) return;
      const mappedRooms = storedRooms.flatMap((stored) => {
        const bundledRoom = ROOMS.find((room) => room.id === stored.id);
        if (!bundledRoom) return [];
        return [{
          ...bundledRoom,
          name: stored.name,
          category: stored.category,
          building: stored.building,
          floor: stored.floor,
          facilities: stored.facilities,
          seats: stored.capacity,
          bookingMode: stored.booking_mode,
          hourlyRate: stored.hourly_rate,
        }];
      });
      if (mappedRooms.length > 0) setRoomCatalog(mappedRooms);
      setCatalogError("");
    }).catch((error: unknown) => {
      if (active) setCatalogError(error instanceof Error ? error.message : "Could not load the room catalog.");
    });
    return () => { active = false; };
  }, []);

  const filteredRooms = useMemo(() => {
    return roomCatalog.filter((room) => {
      const matchesSearch =
        room.name.toLowerCase().includes(search.toLowerCase()) ||
        room.building.toLowerCase().includes(search.toLowerCase());

      const matchesFilter =
        filter === "All" ||
        room.category === filter;

      return matchesSearch && matchesFilter;
    });
  }, [roomCatalog, search, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.homeScroll}>
        <View style={styles.homeHeader}>
          <View>
            <Text style={styles.homeEyebrow}>STUDY & MEET</Text>
            <Text style={styles.homeTitle}>Find your space</Text>
          </View>
          <View style={styles.homeAvatar}>
            <Text style={styles.avatarText}>KL</Text>
          </View>
        </View>

        <ImageBackground source={ROOMS[0].image} imageStyle={styles.homeHeroImage} style={styles.homeHero}>
          <View style={styles.homeHeroTop}>
            <View style={styles.heroAvailability}><View style={styles.heroAvailabilityDot} /><Text style={styles.heroAvailabilityText}>Spaces available today</Text></View>
            <Ionicons name="sparkles-outline" size={20} color="#fff" />
          </View>
          <View style={styles.homeHeroBottom}>
            <BlurView intensity={48} tint="dark" style={styles.homeHeroGlass}>
              <Text style={styles.homeHeroKicker}>A BETTER PLACE TO FOCUS</Text>
              <Text style={styles.homeHeroTitle}>Rooms made for{`\n`}big ideas.</Text>
              <Pressable style={styles.homeHeroAction} onPress={() => navigation.navigate("RoomDetail", { room: ROOMS[0] })}>
                <Text style={styles.homeHeroActionText}>Explore meeting rooms</Text>
                <Ionicons name="arrow-forward" size={16} color="#17213A" />
              </Pressable>
            </BlurView>
          </View>
        </ImageBackground>

        <View style={styles.homeSearchRow}>
          <Ionicons name="search-outline" size={19} color="#8A929F" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search rooms or locations"
            placeholderTextColor="#98A2B3"
            style={styles.homeSearchInput}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")}>
            <Ionicons name={search ? "close-circle" : "search-outline"} size={19} color="#667085" />
          </Pressable>
        </View>

        {catalogError ? (
          <View style={styles.bookingErrorNotice}>
            <Ionicons name="alert-circle-outline" size={19} color="#B42318" />
            <Text style={styles.bookingErrorText}>Room data needs the Supabase migration: {catalogError}</Text>
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.homeCategoryRow}>
          {["All", "Meeting room", "Library", "Study room"].map((item, index) => (
            <Pressable key={item} onPress={() => setFilter(item)} style={[styles.homeCategory, filter === item && styles.homeCategoryActive]}>
              <Ionicons
                name={index === 0 ? "apps-outline" : index === 1 ? "people-outline" : index === 2 ? "library-outline" : "book-outline"}
                size={15}
                color={filter === item ? "#fff" : "#667085"}
              />
              <Text style={[styles.homeCategoryText, filter === item && styles.homeCategoryTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.homeSectionHeader}>
          <View><Text style={styles.homeSectionTitle}>Spaces for you</Text><Text style={styles.homeSectionCaption}>{filteredRooms.length} spaces to explore</Text></View>
          <Ionicons name="options-outline" size={19} color="#667085" />
        </View>
        <View style={styles.homeRoomList}>
          {filteredRooms.map((room) => <RoomCard key={room.id} room={room} />)}
          {filteredRooms.length === 0 && <Text style={styles.emptyText}>No rooms match this search.</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RoomDetail({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "RoomDetail">) {
  const { room } = route.params;

  return (
    <SafeAreaView style={styles.detailPage} edges={[]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailScroll}>
        <ImageBackground source={room.image} style={styles.detailHero} imageStyle={styles.detailHeroImage} resizeMode="cover">
          <SafeAreaView style={styles.detailHeroSafe} edges={["top"]}>
            <View style={styles.detailHeroTop}>
              <Pressable style={styles.detailGlassButton} onPress={() => navigation.goBack()}>
                <BlurView intensity={48} tint="light" style={styles.detailGlassInner}><Ionicons name="arrow-back" size={20} color="#17213A" /></BlurView>
              </Pressable>
              <Pressable style={styles.detailGlassButton}>
                <BlurView intensity={48} tint="light" style={styles.detailGlassInner}><Ionicons name="heart-outline" size={20} color="#17213A" /></BlurView>
              </Pressable>
            </View>
            <View style={styles.detailHeroCaption}>
              <BlurView intensity={42} tint="dark" style={styles.detailHeroGlass}>
                <View style={styles.heroAvailability}><View style={styles.heroAvailabilityDot} /><Text style={styles.heroAvailabilityText}>{room.status} today</Text></View>
                <Text style={styles.detailHeroTitle}>{room.name}</Text>
                <Text style={styles.detailHeroPrice}>{formatCurrency(room.hourlyRate)}<Text style={styles.detailHeroUnit}> / hour</Text></Text>
              </BlurView>
            </View>
          </SafeAreaView>
        </ImageBackground>

        <View style={styles.detailSheet}>
          <View style={styles.detailSheetHandle} />
          <Text style={styles.detailCategory}>{room.category.toUpperCase()}</Text>
          <View style={styles.detailLocationLine}>
            <Ionicons name="location" size={16} color="#7786F5" />
            <Text style={styles.detailLocationText}>{room.building} · {room.floor}</Text>
          </View>
          <View style={styles.detailFacts}>
            <View style={styles.detailFact}>
              <View style={styles.detailFactIcon}><Ionicons name="people-outline" size={18} color="#5364D8" /></View>
              <View><Text style={styles.detailFactLabel}>CAPACITY</Text><Text style={styles.detailFactValue}>{room.bookingMode === "whole-room" ? `${room.seats} people` : `${room.seats} seats`}</Text></View>
            </View>
            <View style={styles.detailFactDivider} />
            <View style={styles.detailFact}>
              <View style={styles.detailFactIcon}><Ionicons name="time-outline" size={18} color="#5364D8" /></View>
              <View><Text style={styles.detailFactLabel}>BOOKING</Text><Text style={styles.detailFactValue}>{room.bookingMode === "whole-room" ? "Entire room" : "By the seat"}</Text></View>
            </View>
          </View>

          <Text style={styles.detailSectionTitle}>Made for focused work</Text>
          <Text style={styles.detailDescription}>
            {room.bookingMode === "whole-room"
              ? `A private ${room.seats}-person space for team meetings, presentations, and collaborative sessions.`
              : "A calm, comfortable space for reading, study sessions, and focused work."}
          </Text>
          <Text style={styles.detailSectionTitle}>What this space offers</Text>
          <View style={styles.amenityList}>
            {room.facilities.map((facility) => (
              <View style={styles.amenityChip} key={facility}>
                <Ionicons name="checkmark-circle" size={16} color="#5364D8" />
                <Text style={styles.amenityText}>{facility}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.detailBookingBar}>
        <View><Text style={styles.detailBookingPrice}>{formatCurrency(room.hourlyRate)}</Text><Text style={styles.detailBookingUnit}>per hour</Text></View>
        <Pressable
          style={styles.detailBookingButton}
          onPress={() => navigation.navigate("Booking", { room })}
        >
          <Text style={styles.primaryButtonText}>{room.bookingMode === "whole-room" ? "Book this room" : "Choose a seat"}</Text>
          <Ionicons name="arrow-forward" size={17} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoItem}>
      <Ionicons name={icon} size={22} color="#2457F5" />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const START_TIMES = Array.from({ length: 13 }, (_, index) => `${String(index + 8).padStart(2, "0")}:00`);
const BOOKING_DATES = Array.from({ length: 7 }, (_, index) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + index);
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    day: new Intl.DateTimeFormat("vi-VN", { weekday: "short" }).format(date),
    number: String(date.getDate()),
  };
});

type BookingStage = "select" | "checkout" | "payment" | "submitted";

function BookingScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Booking">) {
  const { room } = route.params;
  const reservations = useBookingStore((s) => s.reservations);
  const setRoomAvailability = useBookingStore((s) => s.setRoomAvailability);
  const upsertBooking = useBookingStore((s) => s.upsertBooking);
  const [date, setDate] = useState(BOOKING_DATES[0].key);
  const [startTime, setStartTime] = useState("");
  const [durationHours, setDurationHours] = useState(1);
  const [stage, setStage] = useState<BookingStage>("select");
  const [pendingBooking, setPendingBooking] = useState<Booking | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [holdBookingId, setHoldBookingId] = useState<string | null>(null);
  const [heldAmount, setHeldAmount] = useState(0);
  const [paymentReference, setPaymentReference] = useState("");
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState("");
  const [savingHold, setSavingHold] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [agreedToTransfer, setAgreedToTransfer] = useState(false);
  const [now, setNow] = useState(Date.now());
  const preserveHold = React.useRef(false);
  const currentHoldId = React.useRef<string | null>(null);
  currentHoldId.current = holdBookingId;
  const timeRange = startTime ? formatTimeRange(startTime, durationHours) : "";
  const { bankId, accountNumber: bankAccount, accountName } = vietQrConfig;
  const qrUrl = bankAccount && pendingBooking
    ? `https://img.vietqr.io/image/${bankId}-${bankAccount}-compact2.png?amount=${pendingBooking.totalPrice}&addInfo=${encodeURIComponent(pendingBooking.paymentReference)}${accountName ? `&accountName=${encodeURIComponent(accountName)}` : ""}`
    : null;

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    if (supabase) {
      void supabase.auth.getUser().then(({ data }) => {
        if (!active || !data.user) return;
        setCustomerName(String(data.user.user_metadata.full_name ?? ""));
        setCustomerEmail(data.user.email ?? "");
      });
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const refreshAvailability = async () => {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return;
      const available = await getRoomAvailability(room.id, date, data.user.id);
      if (!active) return;
      setCurrentUserId(data.user.id);
      setRoomAvailability(room.id, date, available);
      setBookingError("");
    };
    void refreshAvailability().catch((error: unknown) => {
      if (active) setBookingError(error instanceof Error ? error.message : "Could not load availability.");
    });
    const channel = client
      .channel(`availability:${room.id}:${date}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "booking_resources",
        filter: `room_id=eq.${room.id}`,
      }, () => {
        void refreshAvailability().catch((error: unknown) => {
          if (active) setBookingError(error instanceof Error ? error.message : "Could not refresh availability.");
        });
      })
      .subscribe();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [date, room.id, setRoomAvailability]);

  useEffect(() => () => {
    const bookingId = currentHoldId.current;
    if (!preserveHold.current && bookingId) void cancelBookingHold(bookingId);
  }, []);

  const selectedSeats = reservations.filter((reservation) =>
    reservation.roomId === room.id && reservation.date === date && timeRange &&
    timeRangeOverlaps(reservation.time, timeRange) && reservation.status === "held" &&
    reservation.ownerId === currentUserId && (reservation.expiresAt ?? 0) > now,
  );
  const seatIds = Array.from({ length: room.seats }, (_, index) => {
    const row = String.fromCharCode(65 + Math.floor(index / 6));
    const number = (index % 6) + 1;
    return `${row}${number}`;
  });
  const seatRows = Array.from({ length: Math.ceil(seatIds.length / 6) }, (_, index) =>
    seatIds.slice(index * 6, index * 6 + 6),
  );

  const isActiveReservation = (reservation: SeatReservation) =>
    reservation.status === "booked" || (reservation.expiresAt ?? 0) > now;

  const reservationsForRange = (range: string) => reservations.filter((reservation) =>
    reservation.roomId === room.id && reservation.date === date &&
    timeRangeOverlaps(reservation.time, range) && isActiveReservation(reservation),
  );

  const refreshAvailability = async (bookingDate: string) => {
    if (!currentUserId) return;
    const available = await getRoomAvailability(room.id, bookingDate, currentUserId);
    setRoomAvailability(room.id, bookingDate, available);
  };

  useEffect(() => {
    if (!holdBookingId || !holdExpiresAt || new Date(holdExpiresAt).getTime() > now) return;
    setHoldBookingId(null);
    setHoldExpiresAt(null);
    setPaymentReference("");
    setHeldAmount(0);
    preserveHold.current = false;
    void refreshAvailability(date).catch(() => undefined);
  }, [date, holdBookingId, holdExpiresAt, now]);

  const clearCurrentHold = async () => {
    if (!holdBookingId) return true;
    try {
      await cancelBookingHold(holdBookingId);
      setHoldBookingId(null);
      setHoldExpiresAt(null);
      setPaymentReference("");
      setHeldAmount(0);
      await refreshAvailability(date);
      return true;
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Could not release the reservation.");
      return false;
    }
  };

  const replaceCurrentHold = async (
    resourceIds: string[],
    bookingDate: string,
    bookingStartTime: string,
    bookingDuration: number,
  ) => {
    setSavingHold(true);
    setBookingError("");
    try {
      const hold = await holdBookingResources({
        roomId: room.id,
        date: bookingDate,
        startTime: bookingStartTime,
        durationHours: bookingDuration,
        resourceIds,
        replaceBookingId: holdExpiresAt && new Date(holdExpiresAt).getTime() > Date.now()
          ? holdBookingId
          : null,
      });
      setHoldBookingId(hold.bookingId);
      setHoldExpiresAt(hold.holdExpiresAt);
      setPaymentReference(hold.paymentReference);
      setHeldAmount(hold.totalAmount);
      await refreshAvailability(bookingDate);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reserve this time.";
      setBookingError(message.includes("RESOURCE_UNAVAILABLE")
        ? "Someone just reserved this room or seat. Choose another time or seat."
        : message);
      await refreshAvailability(bookingDate).catch(() => undefined);
      return false;
    } finally {
      setSavingHold(false);
    }
  };

  const resourcesForCurrentSelection = () => room.bookingMode === "whole-room"
    ? ["ROOM"]
    : selectedSeats.map((reservation) => reservation.seatId);

  const changeDate = async (nextDate: string) => {
    const resources = resourcesForCurrentSelection();
    if (startTime && resources.length > 0) {
      const updated = await replaceCurrentHold(resources, nextDate, startTime, durationHours);
      if (!updated) return;
    } else if (holdBookingId && !(await clearCurrentHold())) {
      return;
    }
    setDate(nextDate);
  };

  const changeStartTime = async (nextTime: string) => {
    const resources = resourcesForCurrentSelection();
    if (resources.length > 0) {
      const updated = await replaceCurrentHold(resources, date, nextTime, durationHours);
      if (!updated) return;
    }
    setStartTime(nextTime);
  };

  const changeDuration = async (nextDuration: number) => {
    const boundedDuration = Math.max(1, Math.min(8, nextDuration));
    if (boundedDuration === durationHours) return;
    const resources = resourcesForCurrentSelection();
    if (startTime && resources.length > 0) {
      const updated = await replaceCurrentHold(resources, date, startTime, boundedDuration);
      if (!updated) return;
    }
    setDurationHours(boundedDuration);
  };

  const toggleSeat = async (seatId: string) => {
    const selected = selectedSeats.some((reservation) => reservation.seatId === seatId);
    const nextResources = selected
      ? selectedSeats.filter((reservation) => reservation.seatId !== seatId).map((reservation) => reservation.seatId)
      : [...selectedSeats.map((reservation) => reservation.seatId), seatId];
    if (nextResources.length === 0) {
      await clearCurrentHold();
      return;
    }
    if (startTime) await replaceCurrentHold(nextResources, date, startTime, durationHours);
  };

  const selectedResourceIds = room.bookingMode === "whole-room"
    ? ["ROOM"]
    : selectedSeats.map((reservation) => reservation.seatId);
  const estimatedTotal = room.hourlyRate * durationHours *
    (room.bookingMode === "whole-room" ? 1 : selectedResourceIds.length);
  const totalPrice = heldAmount || estimatedTotal;
  const canContinue = Boolean(startTime) && Boolean(holdBookingId) && Boolean(holdExpiresAt && new Date(holdExpiresAt).getTime() > now) && !savingHold && selectedResourceIds.length > 0 &&
    (room.bookingMode === "seat" || selectedSeats.some((reservation) => reservation.seatId === "ROOM"));
  const canSubmitCheckout = customerName.trim().length > 1 && customerEmail.includes("@") && customerPhone.trim().length >= 8;

  const openCheckout = () => {
    if (!canContinue) return;
    setPendingBooking({
      id: holdBookingId!,
      paymentReference,
      room,
      date,
      startTime,
      durationHours,
      seatIds: selectedResourceIds,
      totalPrice: heldAmount,
      paymentStatus: "awaiting-payment",
    });
    setStage("checkout");
  };

  const submitTransfer = async () => {
    if (!pendingBooking || !qrUrl) return;
    try {
      await submitBookingTransfer({
        bookingId: pendingBooking.id,
        customerName,
        customerEmail,
        customerPhone,
      });
      upsertBooking({ ...pendingBooking, paymentStatus: "awaiting-review" });
      await refreshAvailability(date);
      preserveHold.current = true;
      setStage("submitted");
    } catch (error) {
      Alert.alert("Could not submit transfer", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.bookingContent} showsVerticalScrollIndicator={false}>
        <View style={styles.detailTopBar}>
          <Pressable
            style={styles.iconButton}
            onPress={() => {
              if (stage === "payment") setStage("checkout");
              else if (stage === "checkout") setStage("select");
              else navigation.goBack();
            }}
          >
            <Ionicons name="arrow-back" size={21} color="#101828" />
          </Pressable>
          <Text style={styles.detailTopTitle}>
            {stage === "select" ? "Request to book"
              : stage === "checkout" ? "Checkout"
                : stage === "payment" ? "Payment method" : "Booking request"}
          </Text>
          <View style={{ width: 42 }} />
        </View>

        {stage === "select" && (
          <>
            <View style={styles.bookingHero}>
              <Image source={room.image} style={styles.bookingThumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.roomName}>{room.name}</Text>
                <Text style={styles.roomLocation}>{room.category} · {room.building}</Text>
                <Text style={styles.roomRate}>{formatCurrency(room.hourlyRate)} / hour</Text>
              </View>
            </View>

            <Text style={styles.bookingSectionTitle}>Select date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bookingDates}>
              {BOOKING_DATES.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => changeDate(item.key)}
                  style={[styles.dateCard, date === item.key && styles.dateCardActive]}
                >
                  <Text style={[styles.dateDay, date === item.key && styles.whiteText]}>{item.day}</Text>
                  <Text style={[styles.dateNumber, date === item.key && styles.whiteText]}>{item.number}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.bookingSectionHeading}>
              <Text style={styles.bookingSectionTitle}>Duration</Text>
              <Text style={styles.bookingSectionHint}>Hourly rate</Text>
            </View>
            <View style={styles.durationControl}>
              <Pressable disabled={savingHold} style={styles.durationButton} onPress={() => changeDuration(durationHours - 1)}>
                <Ionicons name="remove" size={20} color="#2457F5" />
              </Pressable>
              <Text style={styles.durationValue}>{durationHours} {durationHours === 1 ? "hour" : "hours"}</Text>
              <Pressable disabled={savingHold} style={styles.durationButton} onPress={() => changeDuration(durationHours + 1)}>
                <Ionicons name="add" size={20} color="#2457F5" />
              </Pressable>
              <Text style={styles.durationTotal}>
                {room.bookingMode === "whole-room"
                  ? formatCurrency(totalPrice)
                  : `${formatCurrency(room.hourlyRate * durationHours)} / seat`}
              </Text>
            </View>

            <Text style={styles.bookingSectionTitle}>Start time</Text>
            <View style={styles.timeGrid}>
              {START_TIMES.filter((slot) => Number(slot.slice(0, 2)) + durationHours <= 22).map((slot) => {
                const range = formatTimeRange(slot, durationHours);
                const active = reservationsForRange(range);
                const unavailable = room.bookingMode === "whole-room"
                  ? active.some((item) => item.seatId === "ROOM" && item.ownerId !== currentUserId)
                  : new Set(active.filter((item) => item.seatId !== "ROOM").map((item) => item.seatId)).size >= room.seats;
                const selected = startTime === slot;
                return (
                  <Pressable
                    key={slot}
                    disabled={unavailable || savingHold}
                    onPress={() => changeStartTime(slot)}
                    style={[styles.timeSlot, selected && styles.timeSlotActive, unavailable && styles.timeSlotUnavailable]}
                  >
                    <Text style={[styles.timeText, selected && styles.whiteText, unavailable && styles.timeTextDisabled]}>{slot}</Text>
                    {room.bookingMode === "whole-room" && (
                      <Text style={[styles.slotAvailability, selected && styles.whiteText]}>{unavailable ? "Booked" : "Available"}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {room.bookingMode === "seat" && (
              <>
                <View style={styles.bookingSectionHeading}>
                  <Text style={styles.bookingSectionTitle}>Choose seats</Text>
                  <Text style={styles.bookingSectionHint}>{selectedSeats.length} selected</Text>
                </View>
                {!startTime ? (
                  <Text style={styles.selectTimeHint}>Choose a start time to view available seats.</Text>
                ) : (
                  <View style={styles.seatMap}>
                    <View style={styles.screenLabel}><Text style={styles.screenText}>QUIET STUDY AREA</Text></View>
                    <View style={styles.seatRows}>
                      {seatRows.map((row, rowIndex) => (
                        <View style={styles.seatRow} key={`row-${rowIndex}`}>
                          <Text style={styles.rowLabel}>{String.fromCharCode(65 + rowIndex)}</Text>
                          {row.map((seatId) => {
                            const reservation = reservations.find((item) =>
                              item.roomId === room.id && item.date === date && item.seatId === seatId &&
                              timeRangeOverlaps(item.time, timeRange) && isActiveReservation(item),
                            );
                            const heldByMe = reservation?.status === "held" && reservation.ownerId === currentUserId;
                            const status = !reservation ? "available" : heldByMe ? "mine" : reservation.status;
                            return (
                              <Pressable
                                key={seatId}
                                accessibilityRole="button"
                                accessibilityLabel={`Seat ${seatId}, ${status}`}
                                disabled={savingHold || status === "booked" || status === "held"}
                                onPress={() => toggleSeat(seatId)}
                                style={[styles.seat, status === "booked" && styles.seatBooked, status === "held" && styles.seatHeld, status === "mine" && styles.seatMine]}
                              >
                                <Text style={[styles.seatText, status !== "available" && styles.seatTextLight]}>{seatId.slice(1)}</Text>
                              </Pressable>
                            );
                          })}
                          <Text style={styles.rowLabel}>{String.fromCharCode(65 + rowIndex)}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.seatLegend}>
                      <SeatLegend color={styles.seatAvailable} label="Available" />
                      <SeatLegend color={styles.seatMine} label="Selected" />
                      <SeatLegend color={styles.seatBooked} label="Unavailable" />
                    </View>
                  </View>
                )}
              </>
            )}

            <View style={styles.notice}>
              <Ionicons name="time-outline" size={20} color="#2457F5" />
              <Text style={styles.noticeText}>
                {room.bookingMode === "whole-room"
                  ? `The entire ${room.seats}-person room is reserved for your selected hours.`
                  : "Select one or more seats. Each seat is billed by the hour."}
                {" "}Your selection is held for 15 minutes during checkout.
              </Text>
            </View>
            {bookingError ? (
              <View style={styles.bookingErrorNotice}>
                <Ionicons name="alert-circle-outline" size={19} color="#B42318" />
                <Text style={styles.bookingErrorText}>{bookingError}</Text>
              </View>
            ) : null}
          </>
        )}

        {stage === "checkout" && pendingBooking && (
          <View style={styles.checkoutContent}>
            <View style={styles.checkoutRoom}>
              <Image source={room.image} style={styles.bookingThumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.roomName}>{room.name}</Text>
                <Text style={styles.roomLocation}>{room.building}</Text>
              </View>
            </View>
            <Text style={styles.bookingSectionTitle}>Personal data</Text>
            <View style={styles.checkoutForm}>
              <TextInput
                value={customerName}
                onChangeText={setCustomerName}
                placeholder="Full name"
                placeholderTextColor="#98A2B3"
                style={styles.checkoutInput}
                autoCapitalize="words"
              />
              <TextInput
                value={customerEmail}
                onChangeText={setCustomerEmail}
                placeholder="Email address"
                placeholderTextColor="#98A2B3"
                style={styles.checkoutInput}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TextInput
                value={customerPhone}
                onChangeText={setCustomerPhone}
                placeholder="Phone number"
                placeholderTextColor="#98A2B3"
                style={styles.checkoutInput}
                keyboardType="phone-pad"
              />
            </View>
            <Text style={styles.bookingSectionTitle}>Your booking</Text>
            <View style={styles.checkoutPanel}>
              <View style={styles.checkoutRow}><Text style={styles.checkoutLabel}>Date</Text><Text style={styles.checkoutValue}>{date}</Text></View>
              <View style={styles.checkoutRow}><Text style={styles.checkoutLabel}>Time</Text><Text style={styles.checkoutValue}>{formatTimeRange(startTime, durationHours).replace("-", " - ")}</Text></View>
              <View style={styles.checkoutRow}><Text style={styles.checkoutLabel}>Booking</Text><Text style={styles.checkoutValue}>{room.bookingMode === "whole-room" ? `Entire room · ${room.seats} people` : `Seats ${selectedResourceIds.join(", ")}`}</Text></View>
              <View style={styles.checkoutRow}><Text style={styles.checkoutLabel}>Rate</Text><Text style={styles.checkoutValue}>{formatCurrency(room.hourlyRate)} × {durationHours} hour{durationHours > 1 ? "s" : ""}{room.bookingMode === "seat" ? ` × ${selectedResourceIds.length} seat${selectedResourceIds.length > 1 ? "s" : ""}` : ""}</Text></View>
              <View style={styles.checkoutTotalRow}><Text style={styles.checkoutTotalLabel}>Total</Text><Text style={styles.checkoutTotal}>{formatCurrency(pendingBooking.totalPrice)}</Text></View>
            </View>
            <View style={styles.notice}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#2457F5" />
              <Text style={styles.noticeText}>Payment is by VietinBank transfer. The booking stays pending until payment is verified.</Text>
            </View>
          </View>
        )}

        {stage === "payment" && pendingBooking && (
          <View style={styles.paymentContent}>
            <View style={styles.paymentMethodRow}>
              <View style={styles.paymentBankIcon}><Ionicons name="business-outline" size={22} color="#2457F5" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentBankTitle}>VietinBank QR transfer</Text>
                <Text style={styles.paymentBankSubtitle}>Scan with your banking app</Text>
              </View>
              <Ionicons name="checkmark-circle" size={22} color="#12B76A" />
            </View>
            <View style={styles.qrPanel}>
              {qrUrl ? (
                <Image source={{ uri: qrUrl }} style={styles.qrImage} resizeMode="contain" />
              ) : (
                <View style={styles.qrPlaceholder}>
                  <Ionicons name="qr-code-outline" size={62} color="#98A2B3" />
                  <Text style={styles.qrPlaceholderTitle}>QR not configured</Text>
                  <Text style={styles.qrPlaceholderText}>Add your VietinBank account details to .env, then restart Expo.</Text>
                </View>
              )}
            </View>
            <View style={styles.transferDetails}>
              <View style={styles.checkoutRow}><Text style={styles.checkoutLabel}>Bank</Text><Text style={styles.checkoutValue}>VietinBank</Text></View>
              {accountName ? <View style={styles.checkoutRow}><Text style={styles.checkoutLabel}>Account name</Text><Text style={styles.checkoutValue}>{accountName}</Text></View> : null}
              <View style={styles.checkoutRow}><Text style={styles.checkoutLabel}>Amount</Text><Text style={styles.checkoutTotal}>{formatCurrency(pendingBooking.totalPrice)}</Text></View>
              <View style={styles.checkoutRow}><Text style={styles.checkoutLabel}>Transfer note</Text><Text style={styles.checkoutValue}>{paymentReference}</Text></View>
            </View>
            <Pressable style={styles.transferConsent} onPress={() => setAgreedToTransfer((current) => !current)}>
              <View style={[styles.consentCheckbox, agreedToTransfer && styles.consentCheckboxActive]}>
                {agreedToTransfer && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={styles.transferConsentText}>I will transfer the exact amount and include the booking reference.</Text>
            </Pressable>
            <Text style={styles.paymentDisclaimer}>Only confirm after sending the exact amount. Transfers are not automatically verified by this demo.</Text>
          </View>
        )}

        {stage === "submitted" && pendingBooking && (
          <View style={styles.paymentComplete}>
            <View style={styles.pendingPaymentIcon}><Ionicons name="time-outline" size={34} color="#2457F5" /></View>
            <Text style={styles.paymentCompleteTitle}>Transfer submitted</Text>
            <Text style={styles.paymentCompleteText}>Booking {pendingBooking.id} is waiting for payment verification. It is not confirmed yet.</Text>
            <Text style={styles.paymentCompleteAmount}>{formatCurrency(pendingBooking.totalPrice)}</Text>
            <Pressable style={styles.primaryButton} onPress={() => navigation.navigate("MainTabs")}>
              <Text style={styles.primaryButtonText}>View my bookings</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      {stage === "select" && (
        <View style={styles.bookingBottomBar}>
          <View>
            <Text style={styles.bottomBarCaption}>{room.bookingMode === "seat" && selectedResourceIds.length === 0 ? "RATE / SEAT" : "ESTIMATED TOTAL"}</Text>
            <Text style={styles.bottomBarPrice}>{room.bookingMode === "seat" && selectedResourceIds.length === 0 ? "Select seats" : formatCurrency(totalPrice)}</Text>
          </View>
          <Pressable disabled={!canContinue} onPress={openCheckout} style={[styles.bottomBarButton, !canContinue && styles.disabledButton]}>
            <Text style={styles.primaryButtonText}>Continue</Text><Ionicons name="arrow-forward" size={17} color="#fff" />
          </Pressable>
        </View>
      )}
      {stage === "checkout" && pendingBooking && (
        <View style={styles.bookingBottomBar}>
          <View><Text style={styles.bottomBarCaption}>TOTAL TO PAY</Text><Text style={styles.bottomBarPrice}>{formatCurrency(pendingBooking.totalPrice)}</Text></View>
          <Pressable disabled={!canSubmitCheckout} onPress={() => setStage("payment")} style={[styles.bottomBarButton, !canSubmitCheckout && styles.disabledButton]}>
            <Text style={styles.primaryButtonText}>Choose payment</Text><Ionicons name="arrow-forward" size={17} color="#fff" />
          </Pressable>
        </View>
      )}
      {stage === "payment" && pendingBooking && (
        <View style={styles.bookingBottomBar}>
          <View><Text style={styles.bottomBarCaption}>TRANSFER AMOUNT</Text><Text style={styles.bottomBarPrice}>{formatCurrency(pendingBooking.totalPrice)}</Text></View>
          <Pressable disabled={!qrUrl || !agreedToTransfer} onPress={submitTransfer} style={[styles.bottomBarButton, (!qrUrl || !agreedToTransfer) && styles.disabledButton]}>
            <Ionicons name="qr-code-outline" size={17} color="#fff" /><Text style={styles.primaryButtonText}>I have transferred</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function MyBookings() {
  const bookings = useBookingStore((s) => s.bookings);
  const setBookings = useBookingStore((s) => s.setBookings);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    const refresh = async () => {
      const stored = await getMyBookings();
      if (!active) return;
      const mapped = stored.flatMap((item) => {
        const room = ROOMS.find((candidate) => candidate.id === item.roomId);
        if (!room) return [];
        const status: Booking["paymentStatus"] = item.status === "awaiting_verification"
          ? "awaiting-review"
          : item.status === "awaiting_payment" ? "awaiting-payment" : item.status;
        return [{
          id: item.id,
          paymentReference: item.paymentReference,
          room,
          date: item.date,
          startTime: item.startTime,
          durationHours: item.durationHours,
          seatIds: item.resourceIds,
          totalPrice: item.totalAmount,
          paymentStatus: status,
        }];
      });
      setBookings(mapped);
      setLoadError("");
      setLoading(false);
    };
    void refresh().catch((error: unknown) => {
      if (!active) return;
      setLoadError(error instanceof Error ? error.message : "Could not load bookings.");
      setLoading(false);
    });

    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }
    let channel: ReturnType<typeof client.channel> | undefined;
    void client.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      channel = client
        .channel(`my-bookings:${data.user.id}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `user_id=eq.${data.user.id}`,
        }, () => {
          void refresh().catch((error: unknown) => {
            if (active) setLoadError(error instanceof Error ? error.message : "Could not refresh bookings.");
          });
        })
        .subscribe();
    });

    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
    };
  }, [setBookings]);

  const statusLabel: Record<Booking["paymentStatus"], string> = {
    "awaiting-payment": "Awaiting payment",
    "awaiting-review": "Awaiting verification",
    confirmed: "Confirmed",
    cancelled: "Cancelled",
    expired: "Expired",
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header title="My Bookings" subtitle="Your upcoming study sessions" />
      {loadError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Could not load bookings</Text>
          <Text style={styles.emptyText}>{loadError}</Text>
        </View>
      ) : loading ? (
        <View style={styles.empty}><ActivityIndicator size="large" color="#2457F5" /></View>
      ) : bookings.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="calendar-outline" size={34} color="#2457F5" />
          </View>
          <Text style={styles.emptyTitle}>No bookings yet</Text>
          <Text style={styles.emptyText}>
            Choose a room and reserve a time slot to see it here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.bookingCard}>
              <Image source={item.room.image} style={styles.bookingImage} />
              <View style={{ flex: 1 }}>
                <Text style={styles.roomName}>{item.room.name}</Text>
                <Text style={styles.roomLocation}>{item.room.building} · {item.durationHours}h</Text>
                <Text style={styles.bookingTime}>
                  {item.date} • {formatTimeRange(item.startTime, item.durationHours).replace("-", " - ")}
                </Text>
                <Text style={styles.bookingTime}>
                  {item.seatIds[0] === "ROOM" ? `Entire room · ${item.room.seats} people` : `Seats ${item.seatIds.join(", ")}`}
                </Text>
                <Text style={styles.pendingBookingStatus}>{statusLabel[item.paymentStatus]} · {formatCurrency(item.totalPrice)}</Text>
              </View>
              <Ionicons
                name={item.paymentStatus === "confirmed" ? "checkmark-circle" : item.paymentStatus === "cancelled" || item.paymentStatus === "expired" ? "close-circle" : "time-outline"}
                size={23}
                color={item.paymentStatus === "confirmed" ? "#12B76A" : item.paymentStatus === "cancelled" || item.paymentStatus === "expired" ? "#98A2B3" : "#D97706"}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const CLASS_SESSIONS = [
  { id: "eng-101", code: "ENG 101", title: "English Conversation", day: "Monday", time: "09:00 - 10:30", location: "Classroom B-201", seats: 12, color: "#0F766E" },
  { id: "design-201", code: "DESIGN 201", title: "Design Thinking Workshop", day: "Wednesday", time: "13:00 - 15:00", location: "Meeting Room 10", seats: 8, color: "#B45309" },
  { id: "study-110", code: "STUDY 110", title: "Study Skills Lab", day: "Friday", time: "15:00 - 16:30", location: "Learning Center", seats: 16, color: "#2457F5" },
];

function Classes() {
  const [registeredIds, setRegisteredIds] = useState<string[]>([]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header title="Classes" subtitle="Workshops and learning sessions" />
      <View style={styles.classNotice}>
        <Ionicons name="information-circle-outline" size={19} color="#2457F5" />
        <Text style={styles.classNoticeText}>Sample class schedule. Replace with your institution's real courses and times.</Text>
      </View>
      <FlatList
        data={CLASS_SESSIONS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.classList}
        renderItem={({ item }) => {
          const registered = registeredIds.includes(item.id);
          return (
            <View style={styles.classRow}>
              <View style={[styles.classAccent, { backgroundColor: item.color }]} />
              <View style={styles.classDetails}>
                <Text style={styles.classCode}>{item.code}</Text>
                <Text style={styles.classTitle}>{item.title}</Text>
                <View style={styles.classMetaRow}>
                  <Ionicons name="calendar-outline" size={14} color="#667085" />
                  <Text style={styles.classMeta}>{item.day} · {item.time}</Text>
                </View>
                <View style={styles.classMetaRow}>
                  <Ionicons name="location-outline" size={14} color="#667085" />
                  <Text style={styles.classMeta}>{item.location}</Text>
                  <Text style={styles.classMeta}>· {item.seats} seats left</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRegisteredIds((current) => registered
                    ? current.filter((id) => id !== item.id)
                    : [...current, item.id])}
                  style={[styles.classAction, registered && styles.classActionRegistered]}
                >
                  <Text style={[styles.classActionText, registered && styles.classActionTextRegistered]}>
                    {registered ? "Joined · Demo" : "Join class"}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function SeatLegend({ color, label }: { color: ViewStyle; label: string }) {
  return (
    <View style={styles.seatLegendItem}>
      <View style={[styles.seatLegendSwatch, color]} />
      <Text style={styles.seatLegendText}>{label}</Text>
    </View>
  );
}

function Profile() {
  const signOut = () => {
    if (supabase) void supabase.auth.signOut();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header title="Profile" subtitle="Account & preferences" />
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>KL</Text>
        </View>
        <Text style={styles.profileName}>Khánh Linh</Text>
        <Text style={styles.profileEmail}>student@vku.udn.vn</Text>
      </View>

      {[
        ["person-outline", "Personal information"],
        ["notifications-outline", "Notifications"],
        ["settings-outline", "App settings"],
        ["help-circle-outline", "Help & support"],
      ].map(([icon, label]) => (
        <Pressable style={styles.menuItem} key={label}>
          <Ionicons name={icon as any} size={22} color="#475467" />
          <Text style={styles.menuText}>{label}</Text>
          <Ionicons name="chevron-forward" size={19} color="#98A2B3" />
        </Pressable>
      ))}
      <Pressable style={styles.menuItem} onPress={signOut}>
        <Ionicons name="log-out-outline" size={22} color="#475467" />
        <Text style={styles.menuText}>Sign Out</Text>
        <Ionicons name="chevron-forward" size={19} color="#98A2B3" />
      </Pressable>
    </SafeAreaView>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      id="MainTabsNavigator"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#2457F5",
        tabBarInactiveTintColor: "#98A2B3",
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            Browse: "search-outline",
            Classes: "book-outline",
            Bookings: "calendar-outline",
            Profile: "person-outline",
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Browse" component={BrowseRooms} options={{ title: "Browse Rooms" }} />
      <Tab.Screen name="Classes" component={Classes} />
      <Tab.Screen name="Bookings" component={MyBookings} options={{ title: "My Bookings" }} />
      <Tab.Screen name="Profile" component={Profile} />
    </Tab.Navigator>
  );
}

const ONBOARDING_PAGES = [
  {
    category: "PHÒNG MEETING",
    title: "Book Meeting Rooms,\nIn Just a Few Taps",
    description:
      "Find and reserve the perfect meeting space for your team. Fast booking, seamless scheduling, and productive collaboration.",
    image: require("./meeting room.jpg"),
  },
  {
    category: "THƯ VIỆN",
    title: "Explore Knowledge,\nOne Visit Away",
    description:
      "Browse library resources, discover new materials, and enjoy a quiet environment designed for learning and inspiration.",
    image: require("./phòng thư viện.jpg"),
  },
  {
    category: "PHÒNG TỰ HỌC",
    title: "Focus Better,\nStudy Smarter Every Day",
    description:
      "Reserve a private study space and create the ideal environment for deep work, learning, and personal growth.",
    image: require("./phòng tự học.jpg"),
  },
];

type AuthMode = "signIn" | "signUp" | "otp" | "forgot" | "reset";

function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  keyboardType,
  autoCapitalize = "none",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secure?: boolean;
  keyboardType?: "default" | "email-address" | "number-pad";
  autoCapitalize?: "none" | "words";
}) {
  const [showValue, setShowValue] = useState(false);

  return (
    <View style={styles.authFieldGroup}>
      <Text style={styles.authLabel}>{label}</Text>
      <View style={styles.authInputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#98A2B3"
          style={styles.authInput}
          secureTextEntry={secure && !showValue}
          keyboardType={keyboardType ?? "default"}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
        />
        {secure && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showValue ? "Hide password" : "Show password"}
            onPress={() => setShowValue((visible) => !visible)}
            style={styles.passwordToggle}
          >
            <Ionicons
              name={showValue ? "eye-off-outline" : "eye-outline"}
              size={19}
              color="#667085"
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function AuthScreens({
  mode,
  onModeChange,
  onAuthenticated,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onAuthenticated: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setErrorMessage("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const requireSupabase = () => {
    if (!supabase) {
      throw new Error("Add your Supabase URL and publishable key to .env to enable accounts.");
    }
    return supabase;
  };

  const signIn = () => runAction(async () => {
    const client = requireSupabase();
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    onAuthenticated();
  });

  const signUp = () => runAction(async () => {
    const client = requireSupabase();
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: Linking.createURL("auth/callback"),
      },
    });
    if (error) throw error;
    if (data.session) {
      onAuthenticated();
      return;
    }
    setNotice("Check your email to confirm your account, then sign in.");
    onModeChange("signIn");
  });

  const sendOtp = () => runAction(async () => {
    const client = requireSupabase();
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
    setOtpSent(true);
    setNotice("A sign-in code has been sent to your email.");
  });

  const verifyOtp = () => runAction(async () => {
    const client = requireSupabase();
    const { error } = await client.auth.verifyOtp({
      email: email.trim(),
      token: otp,
      type: "email",
    });
    if (error) throw error;
    onAuthenticated();
  });

  const requestPasswordReset = () => runAction(async () => {
    const client = requireSupabase();
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: Linking.createURL("auth/callback"),
    });
    if (error) throw error;
    setNotice("Password reset instructions have been sent to your email.");
  });

  const saveNewPassword = () => runAction(async () => {
    if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
    if (password !== confirmPassword) throw new Error("The passwords do not match.");
    const client = requireSupabase();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    setShowSuccess(true);
  });

  const signInWithGoogle = () => runAction(async () => {
    const client = requireSupabase();
    const redirectTo = Linking.createURL("auth/callback");
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: Platform.OS !== "web" },
    });
    if (error) throw error;
    if (Platform.OS !== "web" && data.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === "success" && result.url) {
        const code = Linking.parse(result.url).queryParams?.code;
        if (typeof code === "string") {
          const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          onAuthenticated();
        }
      }
    }
  });

  const title = {
    signIn: "Let's Sign you in",
    signUp: "Create Account",
    otp: "Enter OTP",
    forgot: "Forgot Password",
    reset: "Create a New Password",
  }[mode];
  const subtitle = {
    signIn: "Welcome back. Sign in to continue.",
    signUp: "Create your account to get started.",
    otp: "Enter the code sent to your email address.",
    forgot: "Recover your account password.",
    reset: "Enter and confirm your new password.",
  }[mode];

  return (
    <SafeAreaView style={styles.authPage} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <KeyboardAvoidingView
        style={styles.authKeyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.authScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.authContent}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => onModeChange(mode === "signIn" ? "signIn" : "signIn")}
              style={styles.authBackButton}
            >
              <Ionicons name="arrow-back" size={21} color="#101828" />
            </Pressable>

            <Text style={styles.authTitle}>{title}</Text>
            <Text style={styles.authSubtitle}>{subtitle}</Text>

            {!supabase && (
              <View style={styles.authSetupNotice}>
                <Ionicons name="information-circle-outline" size={19} color="#2457F5" />
                <Text style={styles.authSetupText}>
                  Connect a Supabase project in .env to enable account access.
                </Text>
              </View>
            )}

            {mode === "signUp" && (
              <AuthField
                label="Full Name"
                value={fullName}
                onChangeText={setFullName}
                placeholder="Enter your name"
                autoCapitalize="words"
              />
            )}

            {(mode === "signIn" || mode === "signUp" || mode === "otp" || mode === "forgot") && (
              <AuthField
                label={mode === "forgot" ? "E-mail" : "Email Address"}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email address"
                keyboardType="email-address"
              />
            )}

            {(mode === "signIn" || mode === "signUp") && (
              <AuthField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                secure
              />
            )}

            {mode === "signIn" && (
              <View style={styles.authInlineLinks}>
                <Pressable onPress={() => onModeChange("otp")}>
                  <Text style={styles.authSecondaryLink}>Sign in with a code</Text>
                </Pressable>
                <Pressable onPress={() => onModeChange("forgot")}>
                  <Text style={styles.authForgotLink}>Forgot Password</Text>
                </Pressable>
              </View>
            )}

            {mode === "otp" && (
              <AuthField
                label="One-time code"
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Enter the 6-digit code"
                keyboardType="number-pad"
              />
            )}

            {mode === "reset" && (
              <>
                <AuthField
                  label="New Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your new password"
                  secure
                />
                <AuthField
                  label="Confirm Password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm your new password"
                  secure
                />
              </>
            )}

            {errorMessage ? <Text style={styles.authError}>{errorMessage}</Text> : null}
            {notice ? <Text style={styles.authNotice}>{notice}</Text> : null}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={
                mode === "signIn" ? signIn
                  : mode === "signUp" ? signUp
                      : mode === "otp" ? (otp.length === 6 ? verifyOtp : sendOtp)
                      : mode === "forgot" ? requestPasswordReset
                        : saveNewPassword
              }
              style={[styles.authPrimaryButton, busy && styles.authButtonDisabled]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.authPrimaryButtonText}>
                  {mode === "signIn" ? "Sign In"
                    : mode === "signUp" ? "Create An Account"
                      : mode === "otp" ? (otp.length === 6 ? "Verify Code" : otpSent ? "Resend Code" : "Send Code")
                        : mode === "forgot" ? "Next" : "Save Password"}
                </Text>
              )}
            </Pressable>

            {mode === "signIn" && (
              <>
                <View style={styles.authSwitchRow}>
                  <Text style={styles.authBodyText}>Don't have an account? </Text>
                  <Pressable onPress={() => onModeChange("signUp")}>
                    <Text style={styles.authLink}>Sign Up</Text>
                  </Pressable>
                </View>
                <View style={styles.authDivider}>
                  <View style={styles.authDividerLine} />
                  <Text style={styles.authDividerText}>Or continue with</Text>
                  <View style={styles.authDividerLine} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={signInWithGoogle}
                  style={styles.googleButton}
                >
                  <Ionicons name="logo-google" size={18} color="#4285F4" />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </Pressable>
              </>
            )}

            {mode === "signUp" && (
              <>
                <View style={styles.authSwitchRow}>
                  <Text style={styles.authBodyText}>Already have an account? </Text>
                  <Pressable onPress={() => onModeChange("signIn")}>
                    <Text style={styles.authLink}>Sign In</Text>
                  </Pressable>
                </View>
                <View style={styles.authDivider}>
                  <View style={styles.authDividerLine} />
                  <Text style={styles.authDividerText}>Or continue with</Text>
                  <View style={styles.authDividerLine} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={signInWithGoogle}
                  style={styles.googleButton}
                >
                  <Ionicons name="logo-google" size={18} color="#4285F4" />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </Pressable>
              </>
            )}

            {(mode === "otp" || mode === "forgot" || mode === "reset") && (
              <Pressable onPress={() => onModeChange("signIn")} style={styles.authSwitchRow}>
                <Text style={styles.authLink}>Back to Sign In</Text>
              </Pressable>
            )}

            {(mode === "signIn" || mode === "signUp") && (
              <Text style={styles.authTerms}>
                By continuing, you agree to our Terms and Conditions of Use.
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showSuccess} transparent animationType="fade" onRequestClose={() => setShowSuccess(false)}>
        <View style={styles.successBackdrop}>
          <View style={styles.successDialog}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={29} color="#fff" />
            </View>
            <Text style={styles.successTitle}>Success</Text>
            <Text style={styles.successDescription}>Your password has been successfully updated.</Text>
            <Pressable
              onPress={() => {
                setShowSuccess(false);
                onAuthenticated();
              }}
              style={styles.successButton}
            >
              <Text style={styles.authPrimaryButtonText}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SplashScreen() {
  return (
    <View style={styles.splashScreen}>
      <StatusBar barStyle="light-content" backgroundColor="#2B55A8" />
      <Image
        source={require("./splash screen.jpeg")}
        style={styles.splashImage}
        resizeMode="contain"
      />
    </View>
  );
}

function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [pageIndex, setPageIndex] = useState(0);
  const page = ONBOARDING_PAGES[pageIndex];
  const isLastPage = pageIndex === ONBOARDING_PAGES.length - 1;

  const advance = () => {
    if (isLastPage) {
      onComplete();
      return;
    }
    setPageIndex((current) => current + 1);
  };

  return (
    <ImageBackground
      source={page.image}
      style={styles.onboardingBackground}
      imageStyle={styles.onboardingImage}
      blurRadius={4}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.onboardingShade} />
      <SafeAreaView style={styles.onboardingScreen} edges={["top", "bottom"]}>
        <View style={styles.onboardingContent}>
          <Text style={styles.onboardingCategory}>{page.category}</Text>
          <Text style={styles.onboardingTitle}>{page.title}</Text>
          <Text style={styles.onboardingDescription}>{page.description}</Text>

          <View style={styles.onboardingPagination}>
            {ONBOARDING_PAGES.map((item, index) => (
              <View
                key={item.category}
                style={[
                  styles.onboardingDot,
                  index === pageIndex && styles.onboardingDotActive,
                ]}
              />
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={advance}
            style={styles.onboardingButton}
          >
            <Text style={styles.onboardingButtonText}>
              {isLastPage ? "Get Started" : "Continue"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

function AppContent() {
  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [authReady, setAuthReady] = useState(!supabase);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const recoveryPending = React.useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryPending.current = true;
        setAuthMode("reset");
        setIsAuthenticated(false);
        setAuthReady(true);
        return;
      }
      if (recoveryPending.current && session) {
        setAuthMode("reset");
        setAuthReady(true);
        return;
      }
      if (["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED"].includes(event)) {
        setIsAuthenticated(Boolean(session));
        setAuthReady(true);
      }
    });

    const handleAuthUrl = async (url: string) => {
      const parsed = Linking.parse(url);
      const params = new URLSearchParams(url.split("#")[1] ?? "");
      if (parsed.queryParams?.type === "recovery" || params.get("type") === "recovery") {
        recoveryPending.current = true;
        setAuthMode("reset");
      }

      const code = parsed.queryParams?.code;
      if (typeof code === "string") {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) console.error("Could not complete auth redirect", error.message);
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) console.error("Could not restore auth from redirect", error.message);
      }
    };

    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      void handleAuthUrl(url);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) return handleAuthUrl(url);
    });

    void client.auth.getSession().then(({ data, error }) => {
      if (error) console.error("Could not restore auth session", error.message);
      if (!recoveryPending.current) setIsAuthenticated(Boolean(data.session));
      setAuthReady(true);
    });

    return () => {
      subscription.unsubscribe();
      linkSubscription.remove();
    };
  }, []);

  if (showSplash) return <SplashScreen />;
  if (showOnboarding) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />;
  }
  if (!authReady) {
    return (
      <View style={styles.authLoading}>
        <ActivityIndicator size="large" color="#2457F5" />
      </View>
    );
  }
  if (!isAuthenticated) {
    return (
      <AuthScreens
        mode={authMode}
        onModeChange={setAuthMode}
        onAuthenticated={() => setIsAuthenticated(true)}
      />
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator id="RootStackNavigator" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="RoomDetail" component={RoomDetail} />
        <Stack.Screen name="Booking" component={BookingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  authLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  authPage: { flex: 1, backgroundColor: "#fff" },
  authKeyboard: { flex: 1 },
  authScrollContent: { flexGrow: 1, justifyContent: "center" },
  authContent: { width: "100%", maxWidth: 440, alignSelf: "center", paddingHorizontal: 26, paddingVertical: 18 },
  authBackButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  authTitle: { color: "#171923", fontSize: 23, fontWeight: "800", textAlign: "center" },
  authSubtitle: { color: "#667085", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 8, marginBottom: 26 },
  authSetupNotice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, backgroundColor: "#EEF4FF", marginBottom: 18 },
  authSetupText: { flex: 1, color: "#344054", fontSize: 12, lineHeight: 17 },
  authFieldGroup: { marginBottom: 15 },
  authLabel: { color: "#1D2939", fontSize: 12, fontWeight: "700", marginBottom: 8 },
  authInputWrap: { height: 48, flexDirection: "row", alignItems: "center", backgroundColor: "#F5F6F7", borderRadius: 10, paddingHorizontal: 13 },
  authInput: { flex: 1, height: "100%", color: "#101828", fontSize: 13, outlineStyle: "none" } as any,
  passwordToggle: { padding: 7 },
  authInlineLinks: { flexDirection: "row", justifyContent: "space-between", marginTop: -2, marginBottom: 18 },
  authSecondaryLink: { color: "#475467", fontSize: 12, fontWeight: "600" },
  authForgotLink: { color: "#E54862", fontSize: 12, fontWeight: "600" },
  authPrimaryButton: { height: 51, alignItems: "center", justifyContent: "center", backgroundColor: "#2B55A8", borderRadius: 10, marginTop: 3 },
  authButtonDisabled: { opacity: 0.7 },
  authPrimaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  authError: { color: "#B42318", fontSize: 12, lineHeight: 18, marginBottom: 12 },
  authNotice: { color: "#027A48", fontSize: 12, lineHeight: 18, marginBottom: 12 },
  authSwitchRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 19 },
  authBodyText: { color: "#475467", fontSize: 12 },
  authLink: { color: "#2457F5", fontSize: 12, fontWeight: "700" },
  authDivider: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 21, marginBottom: 16 },
  authDividerLine: { height: 1, flex: 1, backgroundColor: "#EAECF0" },
  authDividerText: { color: "#98A2B3", fontSize: 11 },
  googleButton: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1, borderColor: "#EAECF0", borderRadius: 10, backgroundColor: "#fff" },
  googleButtonText: { color: "#344054", fontSize: 13, fontWeight: "600" },
  authTerms: { color: "#667085", fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 26, paddingHorizontal: 12 },
  successBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "rgba(16, 24, 40, 0.35)" },
  successDialog: { width: "100%", maxWidth: 320, alignItems: "center", padding: 26, borderRadius: 12, backgroundColor: "#fff" },
  successIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "#54C65A", marginBottom: 14 },
  successTitle: { color: "#171923", fontSize: 16, fontWeight: "800" },
  successDescription: { color: "#475467", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7, marginBottom: 17 },
  successButton: { width: 132, height: 40, alignItems: "center", justifyContent: "center", backgroundColor: "#2B55A8", borderRadius: 8 },
  splashScreen: { flex: 1, backgroundColor: "#2B55A8" },
  splashImage: { width: "100%", height: "100%" },
  onboardingBackground: { flex: 1, backgroundColor: "#222" },
  onboardingImage: { transform: [{ scale: 1.04 }] },
  onboardingShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.34)",
  },
  onboardingScreen: { flex: 1 },
  onboardingContent: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 26,
    paddingBottom: 28,
  },
  onboardingCategory: {
    color: "#DCE6FF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textAlign: "center",
    marginBottom: 12,
  },
  onboardingTitle: {
    color: "#fff",
    fontSize: 24,
    lineHeight: 31,
    fontWeight: "800",
    textAlign: "center",
  },
  onboardingDescription: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 25,
  },
  onboardingPagination: {
    height: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginBottom: 25,
  },
  onboardingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.75)",
  },
  onboardingDotActive: { width: 22, backgroundColor: "#2457F5" },
  onboardingButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: "#2457F5",
    alignItems: "center",
    justifyContent: "center",
  },
  onboardingButtonText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  safe: { flex: 1, backgroundColor: "#F3F4F6" },
  homeScroll: { paddingBottom: 28 },
  homeHeader: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  homeEyebrow: { color: "#667085", fontSize: 10, fontWeight: "800", letterSpacing: 1.8 },
  homeTitle: { color: "#18202B", fontSize: 27, fontWeight: "800", marginTop: 4 },
  homeAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#E8EAFE", alignItems: "center", justifyContent: "center" },
  homeHero: { height: 282, marginHorizontal: 18, borderRadius: 23, overflow: "hidden", justifyContent: "space-between", padding: 15 },
  homeHeroImage: { borderRadius: 23 },
  homeHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroAvailability: { minHeight: 30, paddingHorizontal: 11, borderRadius: 16, backgroundColor: "rgba(18, 24, 31, 0.40)", flexDirection: "row", alignItems: "center", gap: 7 },
  heroAvailabilityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#73D49A" },
  heroAvailabilityText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  homeHeroBottom: { borderRadius: 17, overflow: "hidden" },
  homeHeroGlass: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 17, overflow: "hidden", backgroundColor: "rgba(20, 27, 32, 0.28)" },
  homeHeroKicker: { color: "#E7EAF0", fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  homeHeroTitle: { color: "#fff", fontSize: 23, lineHeight: 27, fontWeight: "800", marginTop: 5 },
  homeHeroAction: { alignSelf: "flex-start", height: 37, paddingHorizontal: 12, marginTop: 11, borderRadius: 20, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 9 },
  homeHeroActionText: { color: "#18202B", fontSize: 11, fontWeight: "700" },
  homeSearchRow: { height: 51, marginHorizontal: 20, marginTop: 17, paddingHorizontal: 15, borderRadius: 15, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#EAECF0" },
  homeSearchInput: { flex: 1, height: "100%", color: "#101828", fontSize: 13, outlineStyle: "none" } as any,
  homeCategoryRow: { paddingHorizontal: 20, paddingVertical: 16, gap: 8 },
  homeCategory: { height: 38, paddingHorizontal: 13, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: "#EAECF0", flexDirection: "row", alignItems: "center", gap: 7 },
  homeCategoryActive: { backgroundColor: "#5364D8", borderColor: "#5364D8" },
  homeCategoryText: { color: "#5E6674", fontSize: 11, fontWeight: "600" },
  homeCategoryTextActive: { color: "#fff" },
  homeSectionHeader: { marginHorizontal: 22, marginTop: 5, marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  homeSectionTitle: { color: "#18202B", fontSize: 18, fontWeight: "800" },
  homeSectionCaption: { color: "#8A929F", fontSize: 11, marginTop: 3 },
  homeRoomList: { paddingHorizontal: 18, gap: 11 },
  roomCardImageWrap: { width: 112, minHeight: 128, position: "relative" },
  roomCategoryPill: { position: "absolute", left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.92)" },
  roomCategoryText: { color: "#48536A", fontSize: 9, fontWeight: "700" },
  roomCardMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 9 },
  roomCardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 10 },
  roomRateUnit: { color: "#858D9B", fontSize: 10, fontWeight: "500" },
  roomCapacity: { color: "#858D9B", fontSize: 10, marginTop: 4 },
  roomCardArrow: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#EEF0FF" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
  },
  headerTitle: { fontSize: 25, fontWeight: "800", color: "#101828" },
  headerSubtitle: { marginTop: 4, fontSize: 13, color: "#667085" },
  avatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: "#E9EFFF",
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#2457F5", fontWeight: "800" },
  searchRow: {
    flexDirection: "row", gap: 10, paddingHorizontal: 20, marginTop: 8,
  },
  searchBox: {
    flex: 1, height: 50, borderRadius: 14, backgroundColor: "#fff",
    borderWidth: 1, borderColor: "#EAECF0", flexDirection: "row",
    alignItems: "center", paddingHorizontal: 14,
  },
  searchInput: { flex: 1, marginLeft: 9, fontSize: 14, color: "#101828" },
  filterButton: {
    width: 50, height: 50, borderRadius: 14, backgroundColor: "#fff",
    borderWidth: 1, borderColor: "#EAECF0", alignItems: "center", justifyContent: "center",
  },
  chips: { paddingHorizontal: 20, paddingVertical: 15, gap: 8 },
  chip: {
    paddingHorizontal: 15, height: 36, borderRadius: 18, borderWidth: 1,
    borderColor: "#D0D5DD", backgroundColor: "#fff", justifyContent: "center",
  },
  chipActive: { backgroundColor: "#2457F5", borderColor: "#2457F5" },
  chipText: { color: "#475467", fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  list: { paddingHorizontal: 20, paddingBottom: 25 },
  column: { justifyContent: "space-between" },
  roomCard: {
    width: "100%", minHeight: 148, backgroundColor: "#fff", borderRadius: 17,
    padding: 9, flexDirection: "row", gap: 13, overflow: "hidden",
    borderWidth: 1, borderColor: "#EAECF0",
  },
  roomImage: { width: "100%", height: "100%", borderRadius: 12 },
  roomBody: { flex: 1, paddingVertical: 4, paddingRight: 3 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 5 },
  roomName: { fontSize: 14, fontWeight: "800", color: "#101828", flex: 1 },
  roomLocation: { fontSize: 11, color: "#858D9B", marginTop: 5 },
  roomMeta: { flexDirection: "row", alignItems: "center", marginTop: 9, gap: 4 },
  roomRate: { color: "#2457F5", fontSize: 12, fontWeight: "700", marginTop: 7 },
  metaText: { fontSize: 11, color: "#667085" },
  dot: { color: "#98A2B3", marginHorizontal: 1 },
  statusPill: { borderRadius: 9, paddingHorizontal: 7, paddingVertical: 4 },
  availablePill: { backgroundColor: "#ECFDF3" },
  occupiedPill: { backgroundColor: "#F2F4F7" },
  statusText: { fontSize: 9, fontWeight: "700" },
  availableText: { color: "#039855" },
  occupiedText: { color: "#667085" },

  detailTopBar: {
    height: 60, paddingHorizontal: 18, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
  },
  detailTopTitle: { fontSize: 16, fontWeight: "800", color: "#101828" },
  iconButton: {
    width: 42, height: 42, borderRadius: 13, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#EAECF0",
  },
  detailPage: { flex: 1, backgroundColor: "#F3F4F6" },
  detailScroll: { paddingBottom: 14 },
  detailHero: { height: 400, paddingHorizontal: 18 },
  detailHeroImage: { resizeMode: "cover" },
  detailHeroSafe: { flex: 1, justifyContent: "space-between" },
  detailHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 },
  detailGlassButton: { width: 42, height: 42, overflow: "hidden", borderRadius: 21 },
  detailGlassInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  detailHeroCaption: { marginHorizontal: -4, marginBottom: 38, overflow: "hidden", borderRadius: 18 },
  detailHeroGlass: { padding: 16, overflow: "hidden", backgroundColor: "rgba(20, 27, 32, 0.28)" },
  detailHeroTitle: { color: "#fff", fontSize: 27, fontWeight: "800", marginTop: 7 },
  detailHeroPrice: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 2 },
  detailHeroUnit: { color: "rgba(255,255,255,0.82)", fontSize: 12, fontWeight: "500" },
  detailSheet: { marginTop: -23, paddingHorizontal: 23, paddingTop: 13, paddingBottom: 26, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "#F8F9FB" },
  detailSheetHandle: { width: 38, height: 4, alignSelf: "center", borderRadius: 2, backgroundColor: "#D6D9E0", marginBottom: 19 },
  detailCategory: { color: "#777F91", fontSize: 10, fontWeight: "800", letterSpacing: 1.3 },
  detailLocationLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  detailLocationText: { color: "#626B7A", fontSize: 12 },
  detailFacts: { minHeight: 78, marginTop: 19, padding: 12, borderRadius: 15, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#ECEEF2" },
  detailFact: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  detailFactIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#F0F1FF", alignItems: "center", justifyContent: "center" },
  detailFactLabel: { color: "#9299A6", fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  detailFactValue: { color: "#343B48", fontSize: 11, fontWeight: "700", marginTop: 4 },
  detailFactDivider: { width: 1, height: 35, backgroundColor: "#EAECF0", marginHorizontal: 11 },
  detailSectionTitle: { color: "#202734", fontSize: 16, fontWeight: "800", marginTop: 24 },
  detailDescription: { color: "#747D8C", fontSize: 12, lineHeight: 19, marginTop: 7 },
  amenityList: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  amenityChip: { minHeight: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#ECEEF2" },
  amenityText: { color: "#566071", fontSize: 10, fontWeight: "600" },
  detailBookingBar: { minHeight: 82, paddingHorizontal: 21, paddingTop: 10, paddingBottom: 13, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#EAECF0", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  detailBookingPrice: { color: "#17213A", fontSize: 17, fontWeight: "800" },
  detailBookingUnit: { color: "#8A929F", fontSize: 10, marginTop: 2 },
  detailBookingButton: { minWidth: 190, height: 49, paddingHorizontal: 16, borderRadius: 15, backgroundColor: "#4E5DE0", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  detailContent: { padding: 20 },
  detailTitle: { fontSize: 25, fontWeight: "800", color: "#101828", flex: 1 },
  locationRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 6 },
  locationText: { color: "#667085", fontSize: 13 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: "#101828", marginTop: 25, marginBottom: 13 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  infoItem: {
    width: "48%", backgroundColor: "#fff", borderRadius: 14, padding: 14,
    flexDirection: "row", gap: 10, borderWidth: 1, borderColor: "#EAECF0",
  },
  infoLabel: { fontSize: 11, color: "#98A2B3" },
  infoValue: { fontSize: 12, color: "#344054", fontWeight: "600", marginTop: 3 },
  facilities: { gap: 10 },
  facility: { flexDirection: "row", alignItems: "center", gap: 8 },
  facilityText: { color: "#475467", fontSize: 14 },
  bottomAction: {
    padding: 16, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#EAECF0",
  },
  primaryButton: {
    height: 52, borderRadius: 14, backgroundColor: "#2457F5",
    alignItems: "center", justifyContent: "center",
  },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  disabledButton: { backgroundColor: "#B8C2D1" },

  bookingContent: { paddingBottom: 20 },
  bookingBottomBar: { minHeight: 80, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#EAECF0", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  bottomBarCaption: { color: "#9098A6", fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  bottomBarPrice: { color: "#17213A", fontSize: 16, fontWeight: "800", marginTop: 4 },
  bottomBarButton: { minHeight: 48, minWidth: 148, paddingHorizontal: 14, borderRadius: 15, backgroundColor: "#4E5DE0", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  checkoutForm: { padding: 12, borderRadius: 16, backgroundColor: "#fff", gap: 9, borderWidth: 1, borderColor: "#ECEEF2" },
  checkoutInput: { height: 47, paddingHorizontal: 14, borderRadius: 24, backgroundColor: "#F4F5F7", color: "#202734", fontSize: 12, outlineStyle: "none" } as any,
  transferConsent: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 16 },
  consentCheckbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: "#B9C0CC", alignItems: "center", justifyContent: "center" },
  consentCheckboxActive: { backgroundColor: "#4E5DE0", borderColor: "#4E5DE0" },
  transferConsentText: { flex: 1, color: "#566071", fontSize: 11, lineHeight: 16 },
  bookingHero: {
    marginHorizontal: 20, padding: 12, borderRadius: 14, backgroundColor: "#fff",
    flexDirection: "row", gap: 12, borderWidth: 1, borderColor: "#EAECF0",
  },
  bookingSectionTitle: { color: "#101828", fontSize: 16, fontWeight: "800", marginHorizontal: 20, marginTop: 23, marginBottom: 12 },
  bookingSectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 20 },
  bookingSectionHint: { color: "#667085", fontSize: 12, marginTop: 20 },
  bookingDates: { paddingHorizontal: 20, gap: 8 },
  durationControl: {
    minHeight: 54, marginHorizontal: 20, paddingHorizontal: 10, borderRadius: 12,
    borderWidth: 1, borderColor: "#EAECF0", backgroundColor: "#fff",
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  durationButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "#EEF4FF" },
  durationValue: { color: "#101828", fontSize: 14, fontWeight: "700" },
  durationTotal: { color: "#2457F5", fontSize: 13, fontWeight: "800", marginLeft: "auto" },
  timeSlotUnavailable: { backgroundColor: "#F2F4F7", borderColor: "#EAECF0" },
  timeTextDisabled: { color: "#98A2B3" },
  checkoutContent: { paddingHorizontal: 20, paddingBottom: 24 },
  checkoutRoom: {
    padding: 12, borderRadius: 13, backgroundColor: "#fff", flexDirection: "row",
    gap: 12, borderWidth: 1, borderColor: "#EAECF0", alignItems: "center",
  },
  checkoutPanel: { paddingHorizontal: 15, paddingVertical: 5, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#EAECF0" },
  checkoutRow: { minHeight: 43, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderBottomWidth: 1, borderBottomColor: "#F2F4F7" },
  checkoutLabel: { color: "#667085", fontSize: 12 },
  checkoutValue: { flexShrink: 1, color: "#101828", fontSize: 12, fontWeight: "600", textAlign: "right" },
  checkoutTotalRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  checkoutTotalLabel: { color: "#101828", fontSize: 14, fontWeight: "700" },
  checkoutTotal: { color: "#2457F5", fontSize: 16, fontWeight: "800" },
  paymentContent: { paddingHorizontal: 20, paddingBottom: 26 },
  paymentMethodRow: { minHeight: 72, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#EAECF0", flexDirection: "row", alignItems: "center", gap: 12 },
  paymentBankIcon: { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF4FF" },
  paymentBankTitle: { color: "#101828", fontSize: 13, fontWeight: "700" },
  paymentBankSubtitle: { color: "#667085", fontSize: 11, marginTop: 4 },
  qrPanel: { minHeight: 270, alignItems: "center", justifyContent: "center", marginTop: 16, padding: 18, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#EAECF0" },
  qrImage: { width: 230, height: 230 },
  qrPlaceholder: { width: "100%", minHeight: 225, alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  qrPlaceholderTitle: { color: "#344054", fontSize: 14, fontWeight: "700", marginTop: 12 },
  qrPlaceholderText: { color: "#667085", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7 },
  transferDetails: { marginTop: 14, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#EAECF0" },
  paymentDisclaimer: { color: "#667085", fontSize: 11, lineHeight: 17, textAlign: "center", marginVertical: 15 },
  paymentComplete: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 25, paddingVertical: 60 },
  pendingPaymentIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF4FF" },
  paymentCompleteTitle: { color: "#101828", fontSize: 21, fontWeight: "800", textAlign: "center", marginTop: 18 },
  paymentCompleteText: { color: "#667085", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 9 },
  paymentCompleteAmount: { color: "#2457F5", fontSize: 19, fontWeight: "800", marginTop: 16, marginBottom: 26 },
  pendingBookingStatus: { color: "#B54708", fontSize: 10, fontWeight: "700", marginTop: 6 },
  classNotice: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: "#EEF4FF" },
  classNoticeText: { flex: 1, color: "#344054", fontSize: 11, lineHeight: 16 },
  classList: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 11 },
  classRow: { flexDirection: "row", overflow: "hidden", borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#EAECF0" },
  classAccent: { width: 4 },
  classDetails: { flex: 1, padding: 14 },
  classCode: { color: "#667085", fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  classTitle: { color: "#101828", fontSize: 15, fontWeight: "800", marginTop: 5, marginBottom: 10 },
  classMetaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, marginTop: 5 },
  classMeta: { color: "#667085", fontSize: 11 },
  classAction: { alignSelf: "flex-start", marginTop: 12, paddingHorizontal: 14, height: 34, justifyContent: "center", borderRadius: 8, backgroundColor: "#2457F5" },
  classActionRegistered: { backgroundColor: "#ECFDF3" },
  classActionText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  classActionTextRegistered: { color: "#027A48" },
  bookingRoom: {
    marginHorizontal: 20, padding: 12, borderRadius: 16, backgroundColor: "#fff",
    flexDirection: "row", gap: 12, borderWidth: 1, borderColor: "#EAECF0",
  },
  bookingThumb: { width: 82, height: 82, borderRadius: 12 },
  dateCard: {
    width: 62, height: 68, borderRadius: 16, marginHorizontal: 0,
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#EAECF0",
    alignItems: "center", justifyContent: "center",
  },
  dateCardActive: { backgroundColor: "#2457F5", borderColor: "#2457F5" },
  dateDay: { fontSize: 11, color: "#667085", fontWeight: "600" },
  dateNumber: { fontSize: 22, color: "#101828", fontWeight: "800", marginTop: 3 },
  whiteText: { color: "#fff" },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 20 },
  timeSlot: {
    width: "48%", minHeight: 55, borderRadius: 13, borderWidth: 1,
    borderColor: "#D0D5DD", backgroundColor: "#fff", padding: 10,
    flexDirection: "row", alignItems: "center", gap: 7,
  },
  timeSlotActive: { backgroundColor: "#2457F5", borderColor: "#2457F5" },
  timeSlotDisabled: { backgroundColor: "#F2F4F7", borderColor: "#EAECF0" },
  timeText: { fontSize: 12, color: "#344054", fontWeight: "600" },
  disabledText: { color: "#98A2B3" },
  conflictText: { fontSize: 9, color: "#98A2B3", marginLeft: "auto" },
  slotAvailability: { fontSize: 10, color: "#667085", marginLeft: "auto" },
  seatSectionHeader: {
    paddingHorizontal: 20, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
  },
  freeSeatCount: { color: "#039855", fontSize: 12, fontWeight: "700", marginTop: 25, marginBottom: 13 },
  selectTimeHint: { color: "#667085", fontSize: 13, marginHorizontal: 20, paddingVertical: 14 },
  seatMap: {
    marginHorizontal: 20, paddingVertical: 18, paddingHorizontal: 9,
    borderRadius: 13, backgroundColor: "#fff", borderWidth: 1, borderColor: "#EAECF0",
  },
  screenLabel: {
    marginHorizontal: 34, marginBottom: 19, height: 24, alignItems: "center",
    justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "#D0D5DD",
  },
  screenText: { color: "#98A2B3", fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  seatRows: { gap: 10 },
  seatRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  rowLabel: { width: 8, textAlign: "center", color: "#98A2B3", fontSize: 9, fontWeight: "700" },
  seat: {
    width: 32, height: 34, borderRadius: 9, borderWidth: 1,
    alignItems: "center", justifyContent: "center", position: "relative",
  },
  seatAvailable: { backgroundColor: "#ECFDF3", borderColor: "#12B76A" },
  seatBooked: { backgroundColor: "#667085", borderColor: "#667085" },
  seatHeld: { backgroundColor: "#FEF3F2", borderColor: "#F04438" },
  seatMine: { backgroundColor: "#2457F5", borderColor: "#2457F5" },
  seatText: { color: "#027A48", fontSize: 11, fontWeight: "800" },
  seatTextLight: { color: "#fff" },
  seatTimer: { position: "absolute", bottom: 1, color: "#fff", fontSize: 7, fontWeight: "700" },
  seatLegend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14, marginTop: 20 },
  seatLegendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  seatLegendSwatch: { width: 12, height: 12, borderWidth: 1, borderRadius: 3 },
  seatLegendText: { fontSize: 10, color: "#667085" },
  notice: {
    margin: 20, padding: 13, borderRadius: 13, backgroundColor: "#EEF4FF",
    flexDirection: "row", gap: 8, alignItems: "center",
  },
  bookingErrorNotice: { marginHorizontal: 20, marginBottom: 18, padding: 13, borderRadius: 13, backgroundColor: "#FEF3F2", flexDirection: "row", alignItems: "center", gap: 8 },
  bookingErrorText: { flex: 1, color: "#B42318", fontSize: 12, lineHeight: 18 },
  noticeText: { flex: 1, color: "#344054", fontSize: 12, lineHeight: 18 },
  bookingCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 12, marginBottom: 12,
    flexDirection: "row", gap: 12, borderWidth: 1, borderColor: "#EAECF0",
    alignItems: "center",
  },
  bookingImage: { width: 80, height: 80, borderRadius: 12 },
  bookingTime: { color: "#2457F5", fontWeight: "700", fontSize: 12, marginTop: 7 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 45 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "#EAF0FF",
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { marginTop: 16, fontSize: 19, fontWeight: "800", color: "#101828" },
  emptyText: { textAlign: "center", color: "#667085", lineHeight: 20, marginTop: 7 },

  profileCard: {
    margin: 20, padding: 25, borderRadius: 20, backgroundColor: "#fff",
    alignItems: "center", borderWidth: 1, borderColor: "#EAECF0",
  },
  profileAvatar: {
    width: 78, height: 78, borderRadius: 39, backgroundColor: "#2457F5",
    alignItems: "center", justifyContent: "center",
  },
  profileAvatarText: { color: "#fff", fontSize: 25, fontWeight: "800" },
  profileName: { marginTop: 13, fontSize: 20, fontWeight: "800", color: "#101828" },
  profileEmail: { marginTop: 4, color: "#667085", fontSize: 13 },
  menuItem: {
    marginHorizontal: 20, marginBottom: 10, padding: 17, borderRadius: 14,
    backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1, borderColor: "#EAECF0",
  },
  menuText: { flex: 1, color: "#344054", fontSize: 14, fontWeight: "600" },
  tabBar: {
    height: 70, paddingBottom: 8, paddingTop: 7, borderTopColor: "#EAECF0",
    backgroundColor: "#fff",
  },
  tabLabel: { fontSize: 10, fontWeight: "700" },
});
