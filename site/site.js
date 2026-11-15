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

// Motion. Nothing moves for visitors who ask for reduced motion; the page then shows its finished state.
const calm = !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The doorway opens once: the header logo swings open and back on a visitor's first load.
document.addEventListener("DOMContentLoaded", () => {
  if (calm) return;
  try {
    if (localStorage.getItem("rr_door")) return;
    localStorage.setItem("rr_door", "1");
  } catch {
    return;
  }
  document.querySelector(".nav .logo")?.classList.add("door");
});

// The Discover illustration plays once when it comes into view: the search types itself,
// the "Understood as" tags pop in, then the example cards rise. Without JavaScript it is simply shown.
document.addEventListener("DOMContentLoaded", () => {
  const frame = document.querySelector(".appframe.preview");
  const main = frame?.querySelector(".main");
  const q = main?.querySelector(".search .q");
  if (calm || !frame || !main || !q || !("IntersectionObserver" in window)) return;
  const text = q.textContent;
  main.classList.add("demo");
  q.textContent = "";
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      let i = 0;
      const type = () => {
        i += 2;
        q.textContent = text.slice(0, i);
        if (i < text.length) setTimeout(type, 24);
        else setTimeout(() => main.classList.add("s1"), 250);
      };
      setTimeout(type, 300);
    },
    { threshold: 0.4 },
  );
  io.observe(frame);
});
