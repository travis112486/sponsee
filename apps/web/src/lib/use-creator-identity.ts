import { useMemo } from "react";
import { trpc } from "@/trpc";
import { useAuth } from "@/lib/auth";
import { platformSubtitle, resolveAvatarUrl } from "@/lib/creator-identity";

/**
 * One answer to "who is the signed-in creator, and what do they look like?"
 * for every chrome surface that shows them.
 *
 * Both callers (Sidebar and Topbar) render on the same screen; React Query
 * dedupes the two queries by key, so this is one request pair per session
 * rather than one per component.
 */
export function useCreatorIdentity() {
  const { user } = useAuth();
  const { data: profile } = trpc.settings.getProfile.useQuery();
  const { data: platformRows } = trpc.settings.getPlatforms.useQuery();

  return useMemo(
    () => ({
      name: profile?.displayName || user?.name || null,
      avatarUrl: resolveAvatarUrl({
        profileAvatarUrl: profile?.avatarUrl,
        platformRows,
        userImage: user?.image,
      }),
      subtitle: platformSubtitle(platformRows),
    }),
    [profile?.displayName, profile?.avatarUrl, platformRows, user?.name, user?.image]
  );
}
