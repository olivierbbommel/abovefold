import type { Item } from "@/lib/types";
import StoryRow from "./StoryRow";

/* Kept as an alias so existing call sites keep working; see StoryRow. */
export default function LeadItem({ item }: { item: Item }) {
  return <StoryRow item={item} variant="lead" />;
}
