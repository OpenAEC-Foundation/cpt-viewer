# Open Geotechniek Studio kernel en BRO-XML-crate

Datum: 15 juli 2026

## Doel

De UI-onafhankelijke functionaliteit van Open Geotechniek Studio wordt ondergebracht in herbruikbare Rust-crates in `crates-warehouse`. De desktopapp, REST-API en MCP-server gebruiken daarna dezelfde publieke kernel-API in plaats van eigen varianten van dezelfde use-cases.

De eerste oplevering introduceert twee crates:

- `bro-xml`: een generieke, volledig native Rust-library voor het lezen van BRO-XML;
- `open-geotechniek-kernel`: de Studio-specifieke project- en use-casefaçade boven `bro-xml`, `cpt-core` en andere gespecialiseerde crates.

Beide crates worden ingericht alsof ze later op crates.io worden gepubliceerd. De eerste oplevering integreert en valideert ze alleen binnen `crates-warehouse`; daadwerkelijk publiceren hoort niet bij deze scope.

## Uitgangspunten

- De implementatie is volledig in Rust en heeft geen Node- of TypeScript-runtime nodig.
- `bro-xml` ondersteunt bij oplevering CPT, BHR-GT en BHR-G.
- Tauri, REST en MCP zijn adapters en maken geen deel uit van de kernel.
- Netwerk- en bestandssysteemhandelingen blijven buiten de kernlogica.
- Bestaande frontend-payloads en projectbestanden blijven tijdens de migratie compatibel.
- `cpt-core` blijft in de eerste fase bestaan; de nieuwe crates bouwen erop voort.

## Architectuur

De afhankelijkheidsrichting is strikt van buiten naar binnen:

```text
Tauri / REST / MCP
        |
        v
open-geotechniek-kernel
        |
        +--> bro-xml
        +--> cpt-core
        +--> overige gespecialiseerde crates
```

Geen van de twee nieuwe crates mag afhangen van Tauri, Axum, MCP-transportcode of applicatieglobale toestand. Adapters mogen wel van de kernel afhangen.

### `bro-xml`

`bro-xml` is verantwoordelijk voor:

- herkenning van het BRO-documenttype en de schema-versie;
- namespace-onafhankelijke XML-verwerking;
- parsing en validatie van CPT, BHR-GT en BHR-G;
- sterk getypeerde gemeenschappelijke en objectspecifieke modellen;
- conversie van BRO-nullwaarden en gecodeerde waarden;
- machineleesbare parse- en validatiefouten;
- referentiecodes en menselijk leesbare omschrijvingen waar die stabiel beschikbaar zijn.

`bro-xml` is niet verantwoordelijk voor:

- HTTP-verkeer naar BRO-diensten;
- bestanden openen of opslaan;
- Studio-projectstatus;
- geotechnische berekeningen;
- rapportage, rendering of UI-presentatie.

### `open-geotechniek-kernel`

`open-geotechniek-kernel` is verantwoordelijk voor:

- het geotechnische projectmodel;
- toevoegen, verwijderen en opvragen van sonderingen en boringen;
- unieke objectidentiteiten en andere projectinvarianten;
- import-use-cases voor BRO-XML en bestaande ondersteunde formaten;
- aanroepen van gespecialiseerde domeinfunctionaliteit, zoals CPT-laagdetectie;
- conversie naar en vanuit bestaande projectbestanden;
- samenstellen van transportneutrale export- en rapportdata.

De kernel beheert zijn interne collecties zelf. Er komt geen publieke `Mutex<HashMap<...>>` of andere adaptergerichte statusstructuur in de API.

## Publieke API van `bro-xml`

De primaire API is klein en use-casegericht:

```rust
pub fn detect(xml: &str) -> Result<BroDocumentType, BroError>;
pub fn parse(xml: &str) -> Result<BroDocument, BroError>;
pub fn parse_cpt(xml: &str) -> Result<CptDocument, BroError>;
pub fn parse_bhr_gt(xml: &str) -> Result<BhrGtDocument, BroError>;
pub fn parse_bhr_g(xml: &str) -> Result<BhrGDocument, BroError>;
```

Automatische parsing retourneert een gesloten enum:

```rust
pub enum BroDocument {
    Cpt(CptDocument),
    GeotechnicalBorehole(BhrGtDocument),
    GeologicalBorehole(BhrGDocument),
}
```

`BroDocumentType` bevat dezelfde drie varianten en kan worden gebruikt zonder het volledige document te parsen.

### Gemeenschappelijke documentgegevens

Elk document bevat waar beschikbaar:

- BRO-ID;
- kwaliteitsregime;
- registratie- en onderzoeksdatums;
- bronhouder;
- aangeleverde locatie en CRS;
- verticale positie en referentievlak;
- gedetecteerde document- en schema-versie;
- optioneel de originele XML-bronpayload.

De originele XML wordt niet standaard gedupliceerd als een document alleen tijdelijk wordt geparsed. Een parse-optie bepaalt of de bronpayload moet worden behouden voor projectopslag of latere herverwerking.

### Objectspecifieke modellen

- `CptDocument` bevat sondeermetadata en getypeerde meetpunten.
- `BhrGtDocument` bevat geotechnische boorintervallen, grondbeschrijvingen en geotechnische classificaties.
- `BhrGDocument` bevat lithologische intervallen en geologische eigenschappen.

Bekende, semantisch belangrijke velden krijgen expliciete Rust-typen. Voor onbekende, niet-kritieke velden kan een beperkte `extensions`-structuur worden gebruikt. Verplichte velden mogen nooit stilzwijgend in `extensions` verdwijnen.

### Schema-ondersteuning

De eerste ondersteunde schemafamilies zijn:

- CPT `dscpt/1.1`;
- BHR-GT `dsbhr-gt/2.1`;
- BHR-G `dsbhrg/3.1`.

Een onbekende patch- of namespacevariant wordt geaccepteerd wanneer de vereiste structuur aantoonbaar compatibel is. Een onbekende incompatibele hoofdversie resulteert in `UnsupportedSchema` en wordt niet stilzwijgend als een bekend schema geïnterpreteerd.

## Publieke API van de kernel

De façade werkt met domeinobjecten en stabiele identifiers, bijvoorbeeld:

```rust
let mut project = GeotechnicalProject::new(metadata);
let imported = project.import_bro(xml)?;
let layers = project.detect_cpt_layers(imported.id())?;
let snapshot = project.to_project_file()?;
```

De precieze methoden worden tijdens implementatie testgedreven uitgewerkt, maar de volgende use-cases behoren tot de stabiele grens:

- project aanmaken en metadata wijzigen;
- BRO-document importeren;
- bestaand CPT-formaat importeren;
- objecten oplijsten, opvragen en verwijderen;
- CPT-lagen bepalen via `cpt-core`;
- projectbestand lezen en schrijven als in-memory tekst of bytes;
- export- en rapportinput samenstellen zonder zelf I/O uit te voeren.

De kernel ontvangt inhoud en retourneert inhoud. Paden, dialogs, HTTP-clients en procesglobale caches blijven in de adapters.

## Integratie met `cpt-core`

`cpt-core` blijft de bestaande CPT-domeinfunctionaliteit leveren. Er komt een expliciete, geteste conversie tussen `bro_xml::CptDocument` en `cpt_core::Cpt`.

De conversie:

- behoudt de BRO-ID, locatie, verticale positie, datums en meetreeksen;
- vertaalt ontbrekende of ongeldige meetwaarden zonder informatie te verzinnen;
- bewaart relevante aanvullende metadata;
- produceert een fout wanneer een voor `cpt_core::Cpt` noodzakelijke invariant ontbreekt.

Er wordt in deze fase geen brede hernoeming of opsplitsing van `cpt-core` uitgevoerd.

## Datastroom

Een BRO-import doorloopt drie stappen:

1. `bro-xml` detecteert documenttype en schema-versie.
2. De typespecifieke parser bouwt en valideert het document.
3. De kernel converteert het document naar een projectobject en bewaakt projectinvarianten.

De adapters doen uitsluitend transportwerk:

1. XML ophalen of uit een bestand lezen;
2. de kernel-use-case aanroepen;
3. het transportneutrale resultaat omzetten naar een Tauri-, REST- of MCP-respons.

Tauri-, REST- en MCP-paden moeten uiteindelijk dezelfde kernelmethoden aanroepen. De bestaande adapteruitvoer blijft tijdens de migratie gelijk, tenzij een afzonderlijke API-versiewijziging wordt goedgekeurd.

## Foutmodel

`bro-xml` gebruikt een getypeerde foutenum, minimaal met:

```rust
pub enum BroError {
    InvalidXml { position: Option<u64>, message: String },
    UnsupportedDocument { root: String },
    UnsupportedSchema { document: BroDocumentType, version: String },
    MissingField { path: String },
    InvalidValue { path: String, value: String },
}
```

De kernel gebruikt minimaal:

```rust
pub enum KernelError {
    Bro(BroError),
    DuplicateObject { id: String },
    ObjectNotFound { id: String },
    InvalidProject { message: String },
    Conversion { message: String },
    Export { message: String },
}
```

Werkelijke fouttypen implementeren `std::error::Error` en behouden de onderliggende oorzaak waar dat mogelijk is. Alleen adapters zetten fouten om naar strings, statuscodes of protocol-specifieke foutobjecten.

## Compatibiliteit en migratie

De migratie gebeurt incrementeel:

1. `bro-xml` toevoegen met modellen, parsers en fixtures.
2. `open-geotechniek-kernel` toevoegen met projectmodel en conversies.
3. Bestaande CPT-import via de kernel laten lopen.
4. BHR-GT- en BHR-G-import via de kernel laten lopen.
5. Tauri-, REST- en MCP-adapters op dezelfde kernel-use-cases aansluiten.
6. De bestaande TypeScript-boringparser pas verwijderen nadat fixturepariteit en UI-workflows aantoonbaar slagen.

Bestaande projectbestanden worden niet zonder expliciete versieovergang gewijzigd. Indien nieuwe boringtypen extra velden nodig hebben, moet de lezer oudere bestanden blijven accepteren en moet de schrijver een expliciete, geteste schema-versie gebruiken.

## Referentiecodes

Referentiecodes worden als getypeerde codewaarden gemodelleerd en verliezen hun originele BRO-code niet. Menselijk leesbare Nederlandse omschrijvingen zijn een aanvullende lookup, niet de primaire opgeslagen waarde.

Gegenereerde tabellen moeten reproduceerbaar zijn. Een codegeneratiescript legt bron, datum en generatiecommando vast. Gegenereerde uitvoer wordt gecommit, zodat normale builds en tests geen netwerk nodig hebben.

## Teststrategie

### `bro-xml`

- unit-tests per waardeconversie en resolver;
- fixture-tests voor CPT, BHR-GT en BHR-G;
- tests voor standaardnamespaces, alternatieve prefixes en default namespaces;
- tests voor lege waarden, BRO-nullwaarden en onbekende optionele velden;
- tests voor ontbrekende verplichte velden en ongeldige waarden;
- tests voor beschadigde XML en niet-ondersteunde schema-versies;
- typedetectietests die geen volledig document hoeven te bouwen;
- geen tests met netwerktoegang.

### `open-geotechniek-kernel`

- importtests voor alle drie documenttypen;
- tests voor dubbele IDs, verwijderen en opvragen;
- conversietests tussen `CptDocument` en `cpt_core::Cpt`;
- project-round-trips met bestaande en nieuwe fixtures;
- migratietests voor bestaande projectbestanden;
- contracttests die aantonen dat adapter-use-cases dezelfde kernelmethoden gebruiken.

### Regressiecontrole

De bestaande CPT-, boring- en projectworkflows in de desktopapp blijven onderdeel van de verificatie. Rust-fixtures worden waar mogelijk gedeeld met bestaande applicatiefixtures om uiteenlopende interpretaties van hetzelfde XML-document te voorkomen.

## Documentatie en attributie

Beide crates krijgen rustdoc op alle publieke API's en een zelfstandige README.

De README van `bro-xml` bevat een sectie `Inspiratie en referenties` waarin Bedrock en `bedrock-engineer/bro-xml-parser-ts` met repositorylink worden genoemd. De tekst vermeldt welke functionele ideeën als inspiratie dienden, waaronder automatische typedetectie, ondersteuning voor CPT/BHR-GT/BHR-G en referentiecode-lookups. De README maakt ook expliciet dat `bro-xml` een onafhankelijke Rust-implementatie is en geen port, binding of officiële samenwerking.

De bronlicentie wordt gerespecteerd. Er wordt geen broncode gekopieerd. Als tijdens implementatie toch auteursrechtelijk relevante delen worden overgenomen, wordt dat vooraf beoordeeld en volgens de toepasselijke licentievoorwaarden geattribueerd.

## Packaging

Beide manifests bevatten ten minste:

- naam, beschrijving en versie via de warehouse-workspace;
- Rust edition en minimale ondersteunde Rust-versie wanneer die workspacebreed is vastgesteld;
- licentie en repository;
- README-pad;
- passende keywords en categories;
- alleen noodzakelijke runtime-dependencies.

`cargo package` moet voor beide crates kunnen slagen. Path-dependencies krijgen daarbij een versie die overeenkomt met het latere publicatiemodel, voor zover Cargo dat voor packaging vereist.

## Oplevercriteria

De implementatie is gereed wanneer:

- `bro-xml` CPT, BHR-GT en BHR-G uit representatieve fixtures parseert;
- `open-geotechniek-kernel` deze documenten in één projectmodel beheert;
- de CPT-conversie naar `cpt-core` zonder regressies werkt;
- Tauri, REST en MCP dezelfde kernel-use-cases aanroepen;
- bestaande frontend-payloads en projectbestanden compatibel blijven;
- de TypeScript-boringparser veilig kan worden verwijderd;
- alle nieuwe publieke API's rustdoc hebben;
- de Bedrock-attributie in de `bro-xml`-README staat;
- `cargo test --workspace` in `crates-warehouse` slaagt;
- de relevante desktoptests en builds slagen;
- `cargo package` voor beide nieuwe crates slaagt zonder publicatie uit te voeren.

## Buiten scope

- publicatie op crates.io;
- een nieuwe netwerkclient voor BRO-diensten in de kernel;
- Tauri-, REST- of MCP-protocolwijzigingen;
- een brede herstructurering van `cpt-core`;
- nieuwe geotechnische rekenmethoden;
- een wijziging van het UI-ontwerp.
