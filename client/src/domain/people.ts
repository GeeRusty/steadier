import type { Workspace, WorkspaceContact } from "./types";
import { isDate } from "./time";

export const MAX_PEOPLE = 500;
export const MAX_PERSON_NAME_LENGTH = 120;
export const MAX_PERSON_RELATIONSHIP_LENGTH = 80;
export const MAX_PERSON_CONTEXT_LENGTH = 2000;

export interface ContactInput {
  name: string;
  relationship: string;
  context: string;
  lastContactDate: string | null;
  nextContactDate: string | null;
  birthdayMonthDay?: string | null;
}

export function normalizeContactInput(
  input: ContactInput
): ContactInput | null {
  const name = input.name.trim();
  const relationship = input.relationship.trim();
  const context = input.context.trim();
  const birthdayMonthDay = input.birthdayMonthDay;
  if (
    !name ||
    name.length > MAX_PERSON_NAME_LENGTH ||
    relationship.length > MAX_PERSON_RELATIONSHIP_LENGTH ||
    context.length > MAX_PERSON_CONTEXT_LENGTH ||
    (input.lastContactDate !== null && !isDate(input.lastContactDate)) ||
    (input.nextContactDate !== null && !isDate(input.nextContactDate)) ||
    (birthdayMonthDay != null &&
      (!/^\d{2}-\d{2}$/.test(birthdayMonthDay) ||
        !isDate(`2000-${birthdayMonthDay}`)))
  ) {
    return null;
  }
  return {
    name,
    relationship,
    context,
    lastContactDate: input.lastContactDate,
    nextContactDate: input.nextContactDate,
    ...(birthdayMonthDay !== undefined ? { birthdayMonthDay } : {}),
  };
}

export function createContact(
  workspace: Workspace,
  input: ContactInput,
  id: string,
  at: string
): Workspace {
  const normalized = normalizeContactInput(input);
  if (
    !normalized ||
    !id.trim() ||
    id.length > 128 ||
    !at.trim() ||
    at.length > 64 ||
    (workspace.people?.length ?? 0) >= MAX_PEOPLE ||
    workspace.people?.some(person => person.id === id)
  ) {
    return workspace;
  }
  const contact: WorkspaceContact = {
    id,
    ...normalized,
    status: "active",
    createdAt: at,
    updatedAt: at,
  };
  return { ...workspace, people: [...(workspace.people ?? []), contact] };
}

export function updateContact(
  workspace: Workspace,
  id: string,
  input: ContactInput,
  at: string
): Workspace {
  const normalized = normalizeContactInput(input);
  if (!normalized || !at.trim() || at.length > 64) return workspace;
  const existing = workspace.people?.find(person => person.id === id);
  if (!existing) return workspace;
  return {
    ...workspace,
    people: workspace.people!.map(person =>
      person.id === id ? { ...person, ...normalized, updatedAt: at } : person
    ),
  };
}

export function setContactArchived(
  workspace: Workspace,
  id: string,
  archived: boolean,
  at: string
): Workspace {
  if (!at.trim() || at.length > 64) return workspace;
  const existing = workspace.people?.find(person => person.id === id);
  if (!existing || existing.status === (archived ? "archived" : "active")) {
    return workspace;
  }
  return {
    ...workspace,
    people: workspace.people!.map(person =>
      person.id === id
        ? {
            ...person,
            status: archived ? "archived" : "active",
            updatedAt: at,
          }
        : person
    ),
  };
}

export function deleteContact(workspace: Workspace, id: string): Workspace {
  if (!workspace.people?.some(person => person.id === id)) return workspace;
  return {
    ...workspace,
    people: workspace.people!.filter(person => person.id !== id),
  };
}
