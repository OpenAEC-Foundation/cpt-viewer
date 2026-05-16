// Mirrors cpt_core::Cpt — keep in sync with crates-warehouse/cpt-core/src/domain.rs.

export interface Cpt {
  id: string;
  metadata: Metadata;
  position?: Position;
  points: MeasurementPoint[];
}

export interface Metadata {
  project_name?: string;
  project_number?: string;
  date?: string; // ISO 8601 date
  equipment?: string;
  ground_level_nap?: number;
  source_file: string;
  /**
   * Verbatim file metadata — every keyword/property from the source GEF
   * or BRO file that isn't already mapped to a typed field above. Surfaced
   * in the LeftPanel "Bestandsmetadata" section so the user can inspect
   * everything the parser saw. Lossy (BTreeMap on the Rust side), so
   * repeated keys are joined with " | ".
   */
  extra?: Record<string, string>;
}

export interface Position {
  x_rd: number;
  y_rd: number;
  z_nap?: number;
}

export interface MeasurementPoint {
  depth: number;
  depth_nap?: number;
  qc?: number;
  fs?: number;
  rf?: number;
  u2?: number;
  inclination?: number;
}

export interface Zone {
  number: number;
  name: string;
  color: string;
}

export interface Layer {
  depth_top: number;
  depth_bottom: number;
  zone_number: number;
  zone_name: string;
  zone_color: string;
}

export interface ProjectMeta {
  title: string;
  client: string;
  location: string;
  project_number: string;
  author: string;
  date: string; // ISO 8601
}
