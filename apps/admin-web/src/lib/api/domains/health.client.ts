import axios from 'axios';
import { ALMONDYOUNG_API_BASE_URL } from '@/const/api-const';

export async function getInventoryHealth() {
  const { data } = await axios.get(`${ALMONDYOUNG_API_BASE_URL}/inventory/health`);
  return data;
}
