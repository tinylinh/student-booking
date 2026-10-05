import { supabase } from "./supabase";

export type BookingResource = {
  roomId: string;
  date: string;
  time: string;
  seatId: string;
  status: "held" | "booked";
  ownerId: string;
  expiresAt?: number;
};

export type RoomAvailabilityRow = {
  resource_id: string;
  booking_date: string;
  starts_at: string;
  ends_at: string;
  status: "held" | "awaiting_verification" | "confirmed";
  hold_expires_at: string | null;
  is_mine: boolean;
};

export type BookingHold = {
  bookingId: string;
  paymentReference: string;
  totalAmount: number;
  holdExpiresAt: string;
};

export type StoredBooking = {
  id: string;
  paymentReference: string;
  roomId: string;
  date: string;
  startTime: string;
  durationHours: number;
  totalAmount: number;
  status: "awaiting_payment" | "awaiting_verification" | "confirmed" | "cancelled" | "expired";
  resourceIds: string[];
};

export type StoredRoom = {
  id: string;
  name: string;
  category: "Meeting room" | "Library" | "Study room";
  building: string;
  floor: string;
  facilities: string[];
  capacity: number;
  booking_mode: "whole-room" | "seat";
  hourly_rate: number;
};

function getClient() {
  if (!supabase) throw new Error("Supabase is not configured. Add its URL and publishable key to .env.");
  return supabase;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export async function getRoomAvailability(roomId: string, date: string, userId: string) {
  const { data, error } = await getClient().rpc("get_room_availability", {
    p_room_id: roomId,
    p_booking_date: date,
  });
  if (error) throw error;

  return ((data ?? []) as RoomAvailabilityRow[]).map((row) => ({
    roomId,
    date: row.booking_date,
    time: `${formatTime(row.starts_at)}-${formatTime(row.ends_at)}`,
    seatId: row.resource_id,
    status: row.status === "held" && row.is_mine ? "held" as const : "booked" as const,
    ownerId: row.is_mine ? userId : "another-user",
    expiresAt: row.hold_expires_at ? new Date(row.hold_expires_at).getTime() : undefined,
  } satisfies BookingResource));
}

export async function getBookingRooms(): Promise<StoredRoom[]> {
  const { data, error } = await getClient()
    .from("booking_rooms")
    .select("id, name, category, building, floor, facilities, capacity, booking_mode, hourly_rate")
    .eq("is_active", true)
    .order("category")
    .order("capacity");
  if (error) throw error;
  return (data ?? []) as StoredRoom[];
}

export async function holdBookingResources(input: {
  roomId: string;
  date: string;
  startTime: string;
  durationHours: number;
  resourceIds: string[];
  replaceBookingId?: string | null;
}): Promise<BookingHold> {
  const { data, error } = await getClient().rpc("hold_booking_resources", {
    p_room_id: input.roomId,
    p_booking_date: input.date,
    p_start_time: input.startTime,
    p_duration_hours: input.durationHours,
    p_resource_ids: input.resourceIds,
    p_replace_booking_id: input.replaceBookingId ?? null,
  });
  if (error) throw error;

  const result = data as {
    booking_id: string;
    payment_reference: string;
    total_amount: number;
    hold_expires_at: string;
  };
  return {
    bookingId: result.booking_id,
    paymentReference: result.payment_reference,
    totalAmount: result.total_amount,
    holdExpiresAt: result.hold_expires_at,
  };
}

export async function cancelBookingHold(bookingId: string) {
  const { data, error } = await getClient().rpc("cancel_booking_hold", {
    p_booking_id: bookingId,
  });
  if (error) throw error;
  return data;
}

export async function submitBookingTransfer(input: {
  bookingId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}) {
  const { data, error } = await getClient().rpc("submit_booking_transfer", {
    p_booking_id: input.bookingId,
    p_customer_name: input.customerName,
    p_customer_email: input.customerEmail,
    p_customer_phone: input.customerPhone,
  });
  if (error) throw error;
  return data as { booking_id: string; payment_reference: string; status: string };
}

export async function getMyBookings(): Promise<StoredBooking[]> {
  const { data, error } = await getClient()
    .from("bookings")
    .select("id, payment_reference, room_id, booking_date, starts_at, duration_hours, total_amount, status, booking_resources(resource_id)")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    paymentReference: row.payment_reference,
    roomId: row.room_id,
    date: row.booking_date,
    startTime: formatTime(row.starts_at),
    durationHours: row.duration_hours,
    totalAmount: row.total_amount,
    status: row.status,
    resourceIds: (row.booking_resources ?? []).map((resource: { resource_id: string }) => resource.resource_id),
  }));
}
