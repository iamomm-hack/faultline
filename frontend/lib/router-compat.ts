import { useNavigate, useParams as useReactParams } from "react-router-dom";

export function useRouter() {
  const navigate = useNavigate();
  return { push: (to: string) => void navigate(to) };
}

export function useParams<T extends Record<string, string>>() {
  return useReactParams<T>() as T;
}
