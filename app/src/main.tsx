import { PrivyProvider } from "@privy-io/react-auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app.css";

// Public app ID (also in wrangler.jsonc). Sign-in methods: X, Google, email. No wallets.
const PRIVY_APP_ID = "cmwhggfps01qj0fjs8k8w1zrt";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={{
          loginMethods: ["twitter", "google", "email"],
          appearance: { theme: "light", accentColor: "#0057FF", showWalletLoginFirst: false },
          embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
        }}
      >
        <App />
      </PrivyProvider>
    </StrictMode>,
  );
}
