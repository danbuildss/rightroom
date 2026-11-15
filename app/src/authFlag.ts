// Tiny and Privy-free, so the workspace can flag "clear Privy's session" without loading Privy.
const LOGOUT_FLAG = "rr_privy_logout";

export function markPrivyLogout() {
  try {
    localStorage.setItem(LOGOUT_FLAG, "1");
  } catch {
    /* storage blocked: <Auth logoutFirst> still covers this visit */
  }
}
