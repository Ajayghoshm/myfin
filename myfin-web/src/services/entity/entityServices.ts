import { axios } from '../../data/axios.ts';
import { Entity } from '../trx/trxServices.ts';

const getEntities = () => {
  return axios.get<Entity[]>(`/entities`);
};

export type AddEntityRequest = {
  name: string;
};

const addEntity = (request: AddEntityRequest) => {
  return axios.post<{ entity_id: bigint; name: string }>(`/entities`, request);
};

const removeEntity = (id: bigint) => {
  return axios.delete(`/entities`, { data: { entity_id: id } });
};

export type EditEntityRequest = {
  entity_id: bigint;
  new_name: string;
};

const editEntity = (request: EditEntityRequest) => {
  return axios.put(`/entities`, request);
};

export default {
  getEntities,
  addEntity,
  removeEntity,
  editEntity,
};
