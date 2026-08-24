import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MapAddressSearch from "./MapAddressSearch";
import { useCptStore } from "../../store/useCptStore";

/**
 * Regressie voor GitHub #5: het zoekscherm staat zowel op de Kaart als op
 * de Situatietekening en die views worden bij een tab-wissel ge-unmount.
 * Stond de zoekterm alleen in component-state, dan was het veld na de
 * wissel weer leeg terwijl de kaart nog op dat adres stond.
 */
const LABEL = "Adres of coordinaat zoeken";

describe("MapAddressSearch", () => {
  beforeEach(() => {
    useCptStore.setState({ lastAddressQuery: "", lastMapView: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({ response: { docs: [] } }) }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("bewaart half ingetypte invoer bij het verlaten van de view", () => {
    render(<MapAddressSearch />);
    fireEvent.change(screen.getByLabelText(LABEL), {
      target: { value: "Dordrecht" },
    });
    // Tijdens het typen blijft de store met rust — anders rendert elke
    // component die erop zit mee per toetsaanslag.
    expect(useCptStore.getState().lastAddressQuery).toBe("");

    cleanup();
    expect(useCptStore.getState().lastAddressQuery).toBe("Dordrecht");
  });

  it("toont de vorige zoekterm weer na een tab-wissel", () => {
    render(<MapAddressSearch />);
    fireEvent.change(screen.getByLabelText(LABEL), {
      target: { value: "Grote Kerksplein, Dordrecht" },
    });
    cleanup(); // tab-wissel: de view wordt ge-unmount

    render(<MapAddressSearch />);
    expect(screen.getByLabelText(LABEL)).toHaveValue("Grote Kerksplein, Dordrecht");
  });

  it("zoekt niet opnieuw bij een herstelde zoekterm", () => {
    vi.useFakeTimers();
    useCptStore.setState({ lastAddressQuery: "Dordrecht" });

    render(<MapAddressSearch />);
    vi.advanceTimersByTime(1000);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("wist de onthouden zoekterm via de wis-knop", () => {
    useCptStore.setState({ lastAddressQuery: "Tiel" });
    render(<MapAddressSearch />);
    expect(screen.getByLabelText(LABEL)).toHaveValue("Tiel");

    fireEvent.click(screen.getByTitle("Wissen"));

    expect(useCptStore.getState().lastAddressQuery).toBe("");
    expect(screen.getByLabelText(LABEL)).toHaveValue("");
  });
});
