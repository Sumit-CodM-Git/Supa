export function parkingCounts(society: {
  parking_slot?: number | string | null;
  covered_parking?: number | string | null;
} | null | undefined) {
  const count = (value: unknown) => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  };
  const totalParking = count(society?.parking_slot);
  // Legacy field name: covered_parking is occupancy maintained by security,
  // not a count of resident vehicle profiles or roof-covered spaces.
  const occupiedParking = count(society?.covered_parking);
  const vacantParking = Math.max(0, totalParking - occupiedParking);
  return { totalParking, occupiedParking, vacantParking };
}
