import axios from 'axios';

/** The API's 400, 406 or 409 message when there is one, otherwise the fallback. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (
    axios.isAxiosError(error) &&
    (error.response?.status === 400 || error.response?.status === 406 ||
      error.response?.status === 409)
  ) {
    const message = (error.response.data as { message?: string } | undefined)
      ?.message;
    if (message) return message;
  }
  return fallback;
}
