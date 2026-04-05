import { firebaseAuth } from "./firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getAuthHeader(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new ApiError("UNAUTHORIZED", "Not authenticated", 401);
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const authHeader = await getAuthHeader();

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new ApiError(
      data.error?.code ?? "UNKNOWN",
      data.error?.message ?? "Request failed",
      response.status
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export { ApiError };
