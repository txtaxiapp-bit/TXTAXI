
import { TaximeterRates } from './types';

export const DEFAULT_RATES: TaximeterRates = {
  baseFare: 6.55,
  pricePerKm: 4.80,
  pricePerHour: 55.50, // Tarifa Horária oficial da portaria
  speedThreshold: 11.56, // Velocidade de Transição (55.50 / 4.80)
  flag2Premium: 0.30 // +30% apenas na quilometria
};

// Feriados Nacionais Brasil 2026
export const HOLIDAYS_2026 = [
  '01-01', // Ano Novo
  '04-03', // Sexta-feira Santa
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Sra Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25'  // Natal
];

export const STORAGE_KEYS = {
  RATES: 'tx_taxi_rates',
  TRIPS: 'tx_taxi_trips',
  REPORTS: 'tx_taxi_reports',
  DRIVER: 'tx_taxi_driver'
};

export const MOCK_RADARS: any[] = [
  { id: 'r1', lat: -23.5505, lon: -46.6333, speedLimit: 60, type: 'Fixo', location: 'Av. Paulista, 1000' },
  { id: 'r2', lat: -23.5596, lon: -46.6582, speedLimit: 50, type: 'Móvel', location: 'Rua Augusta, 500' },
  { id: 'r3', lat: -23.5874, lon: -46.6576, speedLimit: 40, type: 'Lombada Eletrônica', location: 'Parque Ibirapuera' }
];

export const APP_INFO = {
  NAME: 'TX TAXI',
  MODEL: 'TX1 Logic Precision Dual Flag',
  VERSION: '3.2.0 RADAR TX1 COPILOT'
};
