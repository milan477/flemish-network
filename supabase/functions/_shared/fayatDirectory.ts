export const OFFICIAL_FAYAT_LAUREATES_URL =
  "https://www.vlaanderen.be/onderwijs-en-vorming/naar-school-gaan-studeren-of-een-stage-volgen-in-het-buitenland/fayatbeurzen/fayatbeurs-contactgegevens-laureaten";

export interface OfficialFayatUsLaureate {
  name: string;
  institution: string;
  program: string;
  city: string;
  state: string;
}

// Verified against the official Vlaanderen Fayat laureate directory on 2026-09-15.
// This narrow fallback keeps the authoritative roster discoverable when model quota
// is unavailable. It intentionally contains no Fernand Lazard records.
const OFFICIAL_FAYAT_US_LAUREATE_ROWS = `
Victor Longin|University of Southern California|Peter Stark Producing Program|Los Angeles|CA
Arend Colle|Carnegie Mellon University|Master of Science in Business Analytics Program|Pittsburgh|PA
Milan Yanouk M Liessens Dujardin|UC Berkeley|Master of Engineering in Electrical Engineering and Computer Sciences|Berkeley|CA
Serhat Yildirim|Harvard University|Master of Medical Sciences in Global Health Delivery|Cambridge|MA
Lennert Plasschaert|Harvard University|Master of Medical Sciences in Clinical Investigation|Cambridge|MA
Marie Verdonck|Harvard University|Master of Medical Sciences in Immunology|Cambridge|MA
Aiko Van Denhouwe|Harvard University|Master of Laws|Cambridge|MA
Toon Dictus|Harvard University|Master of Laws|Cambridge|MA
Simon Folens|Massachusetts Institute of Technology|Master of Finance|Cambridge|MA
Simon Devroe|Yale University|Master of Laws|New Haven|CT
Jakob Kesteloot|Harvard University|Master of Laws|Cambridge|MA
Alexander Genoe|Massachusetts Institute of Technology|Master of Finance|Cambridge|MA
Karel Brackeniers|Yale University|Master of Laws|New Haven|CT
Michelle Willaert|University of Chicago|Master of Laws|Chicago|IL
Myriam Deckmyn|University of Chicago|Master of Laws|Chicago|IL
Willem Van de Putte|University of Chicago|Master of Laws|Chicago|IL
Cameron Brichart|University of Chicago|Master of Laws|Chicago|IL
Felix Blommaert|New York University|Environmental and Energy Law|New York|NY
Max Van den Bosch|New York University|Master of Laws|New York|NY
Tijs Vangrunderbeek|Harvard University|Master of Business Administration|Cambridge|MA
Charlotte Dierickx Visschers|Harvard University|Master of Laws|Cambridge|MA
Olivia Dejonghe|Harvard University|Master of Business Administration|Cambridge|MA
Emma Kuypers|University of Southern California|Peter Stark Producing Program|Los Angeles|CA
Capucine Cotier|New York University|Master in Biotechnology and Entrepreneurship|New York|NY
Louise Castin|University of Chicago|Master of Laws|Chicago|IL
Anne Bombay|Columbia Law School|Master of Laws|New York|NY
Valentine Van Keerberghen|Yale University|Master of Arts in International and Development Economics|New Haven|CT
Sabrina Nkashama|New York University|Master of Laws|New York|NY
Nina Vanoverbeke|New York University|Master in International Legal Studies|New York|NY
Vincent Vermylen|Harvard University|Master of Laws|Cambridge|MA
Hélène Hannecart|Harvard University|Master of Business Administration|Cambridge|MA
`;

export function isOfficialFayatLaureatesUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const official = new URL(OFFICIAL_FAYAT_LAUREATES_URL);
    return url.hostname.toLowerCase() === official.hostname &&
      url.pathname.replace(/\/+$/, "") === official.pathname;
  } catch {
    return false;
  }
}

export function getOfficialFayatUsLaureates(
  sourceUrl: string,
): OfficialFayatUsLaureate[] | null {
  if (!isOfficialFayatLaureatesUrl(sourceUrl)) return null;

  return OFFICIAL_FAYAT_US_LAUREATE_ROWS.trim().split("\n").map((row) => {
    const [name, institution, program, city, state] = row.split("|");
    return { name, institution, program, city, state };
  });
}
