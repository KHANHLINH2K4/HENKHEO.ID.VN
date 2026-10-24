
import {
  Sparkles, ShieldCheck
} from "lucide-react";
import { C } from "./theme.js";

export const CATEGORIES = [
  { id: "toc", label: "Tóc", icon: Sparkles, color: C.primary },
  { id: "damat", label: "Da mặt", icon: Sparkles, color: C.secondary },
  { id: "mong", label: "Móng", icon: Sparkles, color: C.accent },
  { id: "massage", label: "Massage", icon: Sparkles, color: C.accentAlt },
  { id: "spa", label: "Spa", icon: ShieldCheck, color: C.primaryDark },
];
