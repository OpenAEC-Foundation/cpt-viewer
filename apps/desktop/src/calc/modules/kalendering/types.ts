// apps/desktop/src/calc/modules/kalendering/types.ts

/** Soort paal-doorsnede — bepaalt hoe de diameter / D_eq wordt afgeleid. */
export type KalenderingPaalSoort = "rond" | "rechthoekig";

/** Valblok-specificatie. Voorgedefinieerde blokken staan in catalog.ts;
 *  via kind='custom' kan de gebruiker een eigen gewicht/valhoogte
 *  invoeren waaruit E_blok wordt berekend (m · g · h). */
export interface KalenderingValblok {
  id: string;
  name: string;
  /** Gewicht van het valblok [kg]. */
  massaKg: number;
  /** Valhoogte [m]. */
  valhoogteM: number;
  /** Slag-energie E_blok = m · g · h [kNm]. Wordt berekend uit massa
   *  en valhoogte; tonen in UI als alleen-lezen. */
  eBlokKnm: number;
}

export interface KalenderingInput {
  /** Geselecteerde valblok-id (uit catalog) of "custom". */
  valblokId: string;
  /** Custom valblok-data (gebruikt als valblokId === "custom"). */
  customMassaKg: number;
  customValhoogteM: number;
  /** Paal-doorsnede type. */
  paalSoort: KalenderingPaalSoort;
  /** Diameter [mm] (rond) of langste zijde [mm] (rechthoekig). */
  diameterMm: number;
  /** Voor rechthoekige paal: tweede zijde [mm]. Genegeerd voor rond. */
  zijdeBMm: number;
  /** Conusweerstand q_c op paalpunt-niveau [MPa]. */
  conusweerstandMpa: number;
  /** Slag-set in mm — over welke zakkings-afstand we de slagen tellen.
   *  Standaard 400 mm (= 40 cm) zoals in de Excel-formule. */
  slagSetMm: number;
}

export interface KalenderingResult {
  ok: boolean;
  error?: string;
  warnings: string[];
  /** Slag-energie E_blok van de geselecteerde valblok [kNm]. */
  eBlokKnm: number;
  /** Effectieve D (= D voor rond, D_eq = √(a·b) voor rechthoekig) [mm]. */
  dEqMm: number;
  /** Aantal benodigde slagen voor `slagSetMm` zakking — geheel getal,
   *  afgerond NAAR BOVEN (=AFRONDEN.BOVEN.EXCEL). */
  slagenPerSet: number;
  /** Equivalent aantal slagen per meter zakking. */
  slagenPerMeter: number;
}
