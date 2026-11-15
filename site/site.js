// Request-access form: sends to /api/public/access-requests and shows the result in place.
// Without JavaScript the form still posts and lands on /thanks.html.
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("access-form");
  const status = document.getElementById("form-status");
  if (!form || !status) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const data = Object.fromEntries(new FormData(form).entries());
    status.className = "form-status";
    status.textContent = "Sending…";
    button.disabled = true;
    try {
      const res = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        form.reset();
        status.className = "form-status ok";
        status.textContent = "Thanks. We've got your request and will reply by email.";
      } else {
        const body = await res.json().catch(() => null);
        status.className = "form-status err";
        status.textContent = body?.error?.message ?? "Something went wrong. Please try again.";
      }
    } catch {
      status.className = "form-status err";
      status.textContent = "Couldn't send. Check your connection and try again.";
    } finally {
      button.disabled = false;
    }
  });
});
