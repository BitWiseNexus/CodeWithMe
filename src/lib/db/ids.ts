/** Guards user-supplied ids before using them as Firestore document ids. */
export const isValidDocId = (id: unknown): id is string =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 256 &&
  !id.includes("/") &&
  id !== "." &&
  id !== ".." &&
  !/^__.*__$/.test(id);
