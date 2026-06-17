/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in de publieke webbuild (live.yml). Hiermee sluiten we niet-
   *  productie-gerede berekeningsmodules (status !== "available") uit het
   *  register én uit de Extensies-lijst, zodat ze niet via de live site
   *  bereikbaar zijn. Leeg/undefined in desktop- en dev-builds. */
  readonly VITE_PUBLIC_WEB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
