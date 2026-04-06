"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi } from "@/lib/api-client";

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => usersApi.getMe(),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { displayName?: string; phone?: string; bio?: string; preferredLanguage?: string }) =>
      usersApi.updateMe(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
