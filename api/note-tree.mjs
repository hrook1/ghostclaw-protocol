import { handleVercelNoteTree } from "../scripts/lib/vercel-note-tree.mjs";

export default function handler(request, response) {
  return handleVercelNoteTree(request, response);
}
