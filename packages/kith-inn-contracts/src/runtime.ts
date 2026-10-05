import { z } from "zod";

// Import separately from schemas so this runs before their object parsers are created.
export function configureWeappValidation() { z.config({ jitless: true }); }
