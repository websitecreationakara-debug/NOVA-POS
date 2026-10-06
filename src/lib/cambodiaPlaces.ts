// Suggestions for the "New customer" form's Province and District boxes. The
// spellings are the ones already used in the customer records (customers.state /
// customers.capital -- e.g. "Sihaknou Ville", "Komport", "Takéo"), so a new
// customer lands in the same group as the existing ones in the CRM filters
// instead of creating a near-duplicate. Both boxes also accept anything typed
// ("Add or search"), for a place that isn't listed.

export const PROVINCES = [
  "Phnom Penh",
  "Siem Reap",
  "Kandal",
  "Sihaknou Ville",
  "Battambang",
  "Kampong Cham",
  "Tbong Khmum",
  "Svay Rieng",
  "Prey Veng",
  "Banteay Meanchey",
  "Poipet",
  "Komport",
  "Kep",
  "Kampong Spue",
  "Kampong Chnang",
  "Kampong Thom",
  "Kratié",
  "Koh Kong",
  "Takéo",
  "Ratanakiri",
  "Mondol Kiri",
  "Steung Treng",
  "Preah Vihear",
  "Oddar Meanchey",
  "Palin",
  "Pursat",
];

// Phnom Penh's 14 districts (khans). Other provinces have no list here -- the
// District box is then free text.
const PHNOM_PENH_DISTRICTS = [
  "Toul Kouk",
  "Meanchey",
  "Chamkar Mon",
  "Pou Senchey",
  "Russey Keo",
  "Doun Penh",
  "Dangkao",
  "Chbar Ampov",
  "Sen Sok",
  "Boeng Keng Kang",
  "7 Makara",
  "Chroy Changvar",
  "Kambaul",
  "Prek Pnov",
];

export function districtsFor(province: string): string[] {
  const p = province.trim().toLowerCase();
  if (p === "phnom penh") return PHNOM_PENH_DISTRICTS;
  if (p === "kandal") return ["Takhmao"];
  return [];
}

// The choices as they are stored in customers.age / customers.nationality.
export const CUSTOMER_AGES = ["18-24", "25-34", "35-44", "45-54", "55+"];
export const CUSTOMER_GENDERS = ["F", "M"];
export const CUSTOMER_NATIONALITIES = ["KH", "CH", "JP", "KR", "EU", "Other"];
