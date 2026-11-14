import { adelaideClock as clock } from "../../domain/time";
import { addDaysTo } from "../../domain/assets";

/** Test helpers: the page uses today's Adelaide date. */
export const adelaideClock = () => clock().date;
export const addDaysToDate = addDaysTo;
