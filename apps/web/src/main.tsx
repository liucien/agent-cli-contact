import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { startClient } from "./store";
import "./styles.css";

startClient();

const rootEl = document.getElementById("root");
if (rootEl) {
    createRoot(rootEl).render(
        <StrictMode>
            <I18nProvider>
                <App />
            </I18nProvider>
        </StrictMode>,
    );
}
