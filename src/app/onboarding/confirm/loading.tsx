import { Screen } from "@/components/patterns/layout";
import { PageLoading } from "@/components/patterns/states";

export default function Loading() {
  return (
    <Screen>
      <PageLoading label="Loading your profile" />
    </Screen>
  );
}
