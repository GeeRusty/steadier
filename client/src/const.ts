export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Open the sign-in page. Call this from an event handler, e.g.
// `onClick={() => startLogin()}`; it navigates immediately.
export const startLogin = () => {
  window.location.href = "/login";
};
