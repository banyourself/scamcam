import { isWebPage, openCheck } from "./handoff.js";

const form = document.getElementById("form");
const text = document.getElementById("text");
const check = document.getElementById("check");
const page = document.getElementById("page");
const error = document.getElementById("error");
let current = null;

text.addEventListener("input", () => {
  check.disabled = text.value.trim().length === 0;
  error.textContent = "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await openCheck(text.value, current)) {
    window.close();
  } else {
    error.textContent = "Paste a link or message first.";
    text.focus();
  }
});

page.addEventListener("click", async () => {
  if (current && (await openCheck(current.url, current))) {
    window.close();
  }
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  current = tab ?? null;
  if (current && isWebPage(current.url)) {
    page.hidden = false;
  }
});

text.focus();
