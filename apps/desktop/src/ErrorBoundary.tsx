// apps/desktop/src/ErrorBoundary.tsx
//
// Toplevel React error-boundary. Vangt render-fouten in de hele App-tree
// op en toont een leesbare stack-trace IN DE UI zodat het white-screen-
// probleem niet onzichtbaar blijft.
//
// React 18 + Concurrent Mode + StrictMode handelen render-errors anders
// af dan een ouderwetse synchrone throw — ze worden door React intern
// gevangen en de tree wordt unmount zonder dat het `window.error`-event
// vuurt. Daarmee misseert de bestaande `showError`-handler in main.tsx
// React-component-crashes en blijft de root-div leeg = wit scherm.
//
// Met deze ErrorBoundary om <App /> heen wordt de fout direct in de page
// gerendered (rode pre-tag) zodat de gebruiker (en de developer) meteen
// zien welke component crashte en op welke regel.

import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log naar console voor DevTools-debugging, ook al wordt de fout
    // visueel getoond — dan kan de gebruiker hem ook kopiëren via
    // rechts-klik → kopieer in de console.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] React render-crash:", error, info);
    this.setState({ info });
  }

  handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div
        style={{
          padding: 24,
          font: "13px/1.45 'JetBrains Mono', ui-monospace, monospace",
          background: "#fafaf9",
          color: "#27272a",
          minHeight: "100vh",
          overflow: "auto",
        }}
      >
        <h1 style={{ font: "700 18px/1.3 'Inter', sans-serif", color: "#b91c1c", marginTop: 0 }}>
          ⚠ React render-crash — toplevel ErrorBoundary
        </h1>
        <p style={{ font: "500 13px/1.5 'Inter', sans-serif", color: "#52525b", marginBottom: 16 }}>
          Een component in de app heeft een fout gegooid tijdens render.
          De stack-trace hieronder helpt om de oorzaak te lokaliseren.
        </p>
        <button
          onClick={this.handleReload}
          style={{
            padding: "6px 14px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            font: "600 13px 'Inter', sans-serif",
            marginBottom: 16,
          }}
        >
          App opnieuw laden
        </button>
        <h2 style={{ font: "700 14px 'Inter', sans-serif", color: "#dc2626", marginBottom: 4 }}>
          {error.name}: {error.message}
        </h2>
        <pre
          style={{
            background: "#fff",
            border: "1px solid #fecaca",
            borderRadius: 4,
            padding: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: "8px 0 16px",
          }}
        >
          {error.stack ?? "(geen stack beschikbaar)"}
        </pre>
        {info?.componentStack && (
          <>
            <h2 style={{ font: "700 14px 'Inter', sans-serif", color: "#52525b", marginBottom: 4 }}>
              Component-stack
            </h2>
            <pre
              style={{
                background: "#fff",
                border: "1px solid #e7e5e4",
                borderRadius: 4,
                padding: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {info.componentStack}
            </pre>
          </>
        )}
      </div>
    );
  }
}
