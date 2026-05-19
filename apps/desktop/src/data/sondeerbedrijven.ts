/**
 * Catalogus van Nederlandse sondeer- en grondonderzoekbedrijven.
 * Wordt gebruikt door de "Vraag 3 offertes op"-knop in de
 * Situatietekening om de drie dichtstbijzijnde bedrijven voor de
 * gebruiker te selecteren en een mailto-offerte-email te openen.
 *
 * Deze placeholder bevat alleen Fugro zodat de UI compileert; een
 * achtergrond-agent vult deze lijst aan met 20-40 bedrijven via
 * web-research. Vervang dit bestand niet handmatig zolang de agent
 * draait — die schrijft 'm uiteindelijk volledig opnieuw.
 *
 * Bron: handmatig samengesteld via web-research.
 * Open een GitHub-issue als een bedrijf ontbreekt of contact-info
 * niet meer klopt.
 */

export interface Sondeerbedrijf {
  id: string;             // slug, b.v. "fugro" / "wiertsema-partners"
  name: string;
  address: string;
  city: string;
  lat: number;            // WGS84 decimaal
  lon: number;            // WGS84 decimaal
  email: string;
  contactPerson: string;  // mag leeg ("")
  phone: string;
  website: string;
}

export const SONDEERBEDRIJVEN: Sondeerbedrijf[] = [
  {
    id: "fugro",
    name: "Fugro Nederland Land B.V.",
    address: "Veurse Achterweg 10, 2264 SG Leidschendam",
    city: "Leidschendam",
    lat: 52.0769,
    lon: 4.4012,
    email: "info@fugro.com",
    contactPerson: "",
    phone: "+31 (0)70 311 1422",
    website: "https://www.fugro.com",
  },
];
