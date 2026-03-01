
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TaximeterRates, TripData, RadarReport, DriverInfo, Radar } from './types';
import { DEFAULT_RATES, STORAGE_KEYS, HOLIDAYS_2026, APP_INFO, MOCK_RADARS } from './constants';
import TaximeterDisplay from './components/TaximeterDisplay';
import SettingsModal from './components/SettingsModal';
import ChatBot from './components/ChatBot';
import SplashScreen from './components/SplashScreen';
import Logo from './components/Logo';

const App: React.FC = () => {
  const [showSplash, setShowSplash] = useState(true);
  const [rates, setRates] = useState<TaximeterRates>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.RATES);
    return saved ? JSON.parse(saved) : DEFAULT_RATES;
  });

  const getActiveFlag = useCallback((): 1 | 2 => {
    const now = new Date();
    const hours = now.getHours();
    const day = now.getDay();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // Bandeira 2: Domingos, Feriados Nacionais ou Horário Noturno (20h-06h)
    if (day === 0 || HOLIDAYS_2026.includes(mmdd)) return 2;
    if (hours >= 20 || hours < 6) return 2;
    return 1;
  }, []);

  const [trip, setTrip] = useState<TripData>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TRIPS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.status === 'running' || parsed.status === 'paused' || parsed.status === 'finalizing') {
        return parsed;
      }
    }
    return {
      id: Math.random().toString(36).substr(2, 9),
      startTime: Date.now(),
      distance: 0,
      fare: 0,
      status: 'stopped',
      currentFlag: getActiveFlag()
    };
  });

  const [speed, setSpeed] = useState(0);
  const [duration, setDuration] = useState(() => {
    const saved = localStorage.getItem('tx_taxi_duration');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem('tx_taxi_logged_in') === 'true';
  });
  const [isWorking, setIsWorking] = useState(() => {
    return localStorage.getItem('tx_taxi_is_working') === 'true';
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const [driverInfo, setDriverInfo] = useState<DriverInfo>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DRIVER);
    return saved ? JSON.parse(saved) : { name: 'TX - Motorista', isPro: false };
  });

  const [radarReports, setRadarReports] = useState<RadarReport[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.REPORTS);
    return saved ? JSON.parse(saved) : [];
  });

  const activeRadars = useRef<Set<string>>(new Set());
  const audioContext = useRef<AudioContext | null>(null);
  const speedHistory = useRef<number[]>([]);

  // Referências para Lógica de Pulso Metrológico (IPEM Standard)
  const internalFareRef = useRef(trip.fare || rates.baseFare);
  const pulseValue = 0.70; // Valor fixo do pulso conforme aferição real
  const distanceCounter = useRef(0); // Acumulador de metros para o próximo pulso
  const timeCounter = useRef(0); // Acumulador de segundos para o próximo pulso
  
  const watchId = useRef<number | null>(null);
  const lastPos = useRef<{lat: number, lon: number, time: number} | null>(() => {
    const saved = localStorage.getItem('tx_taxi_last_pos');
    return saved ? JSON.parse(saved) : null;
  });
  const lastTickTimestamp = useRef<number>(() => {
    const saved = localStorage.getItem('tx_taxi_last_tick');
    return saved ? parseInt(saved, 10) : Date.now();
  });
  const timerRef = useRef<any>(null);
  const resetTimeoutRef = useRef<any>(null);
  const wakeLock = useRef<any>(null);

  // Persistência de Estado
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TRIPS, JSON.stringify(trip));
    localStorage.setItem('tx_taxi_duration', duration.toString());
    localStorage.setItem('tx_taxi_logged_in', isLoggedIn.toString());
    localStorage.setItem('tx_taxi_is_working', isWorking.toString());
    localStorage.setItem('tx_taxi_last_tick', lastTickTimestamp.current.toString());
    if (lastPos.current) {
      localStorage.setItem('tx_taxi_last_pos', JSON.stringify(lastPos.current));
    }
  }, [trip, duration, isLoggedIn, isWorking]);

  // Screen Wake Lock
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLock.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch (err: any) {
      // Silently handle permission errors to avoid console noise if blocked by policy
      if (err.name !== 'NotAllowedError' && err.name !== 'SecurityError') {
        console.warn("Wake Lock not available:", err.message);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLock.current) {
      wakeLock.current.release();
      wakeLock.current = null;
    }
  };

  const playAlertSound = useCallback((frequency: number = 880, duration: number = 0.1) => {
    try {
      if (!audioContext.current) {
        audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContext.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.error("Audio error", e);
    }
  }, []);

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Intervalo Robusto: Não recria o intervalo quando a velocidade muda
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const updateTripTick = useCallback((deltaSeconds: number = 1) => {
    if (trip.status !== 'running') return;

    const currentSpeed = speedRef.current;
    const newFlag = getActiveFlag();
    const flagMultiplier = newFlag === 2 ? (1 + rates.flag2Premium) : 1;
    const currentPricePerKm = rates.pricePerKm * flagMultiplier;
    
    const distanceStep = (pulseValue / currentPricePerKm);
    const timeStep = (pulseValue / rates.pricePerHour) * 3600;

    let fareChanged = false;

    // Lógica de Comutação Automática (Portaria 124/2022)
    if (currentSpeed < rates.speedThreshold) {
      // Cálculo por Tempo (Tarifa Horária)
      timeCounter.current += deltaSeconds;
      while (timeCounter.current >= timeStep) {
        internalFareRef.current += pulseValue;
        timeCounter.current -= timeStep;
        fareChanged = true;
      }
    } else {
      // Cálculo por Distância (Tarifa Quilométrica)
      while (distanceCounter.current >= distanceStep) {
        internalFareRef.current += pulseValue;
        distanceCounter.current -= distanceStep;
        fareChanged = true;
      }
    }

    // Atualiza o estado apenas se houver mudança na tarifa ou na bandeira
    if (fareChanged || trip.currentFlag !== newFlag) {
      setTrip(prev => ({
        ...prev,
        fare: internalFareRef.current,
        currentFlag: newFlag
      }));
    }
  }, [rates, getActiveFlag, trip.status, trip.currentFlag]);

  const updateTripTickRef = useRef(updateTripTick);
  useEffect(() => {
    updateTripTickRef.current = updateTripTick;
  }, [updateTripTick]);

  useEffect(() => {
    const tick = () => {
      if (trip.status === 'running') {
        const now = Date.now();
        const delta = Math.floor((now - lastTickTimestamp.current) / 1000);
        
        if (delta >= 1) {
          updateTripTickRef.current(delta);
          setDuration(d => d + delta);
          lastTickTimestamp.current = now;
          localStorage.setItem('tx_taxi_last_tick', now.toString());
        }
      } else {
        lastTickTimestamp.current = Date.now();
        localStorage.setItem('tx_taxi_last_tick', Date.now().toString());
      }
    };
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [trip.status]);

  const checkRadars = useCallback((lat: number, lon: number, currentSpeed: number) => {
    MOCK_RADARS.forEach((radar: Radar) => {
      const dist = getDistance(lat, lon, radar.lat, radar.lon) * 1000; // em metros
      
      if (dist <= 400 && !activeRadars.current.has(radar.id)) {
        activeRadars.current.add(radar.id);
        playAlertSound(1200, 0.3);
        
        // Adiciona ao relatório
        const newReport: RadarReport = {
          id: Math.random().toString(36).substr(2, 9),
          timestamp: Date.now(),
          location: radar.location,
          speedAtTime: currentSpeed,
          speedLimit: radar.speedLimit,
          radarType: radar.type,
          driverName: driverInfo.name
        };

        setRadarReports(prev => {
          const updated = [newReport, ...prev].slice(0, 50); // Mantém os últimos 50
          localStorage.setItem(STORAGE_KEYS.REPORTS, JSON.stringify(updated));
          return updated;
        });

        // Notifica o motorista (via console ou UI se necessário, mas o ChatBot também pode reagir)
        console.log(`ALERTA RADAR: ${radar.type} a ${dist.toFixed(0)}m. Limite: ${radar.speedLimit}km/h`);
      } else if (dist > 500 && activeRadars.current.has(radar.id)) {
        activeRadars.current.delete(radar.id);
      }
    });
  }, [driverInfo.name, playAlertSound]);

  const finalizingDistanceCounter = useRef(0);

  const resetToStopped = useCallback(() => {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
    setTrip(prev => ({ 
      ...prev, 
      status: 'stopped', 
      endTime: Date.now(),
      distance: 0,
      fare: 0 
    }));
    setDuration(0);
    internalFareRef.current = 0;
    finalizingDistanceCounter.current = 0;
  }, []);

  const tripStatusRef = useRef(trip.status);
  useEffect(() => {
    tripStatusRef.current = trip.status;
  }, [trip.status]);

  // Geolocation Global: Monitora velocidade mesmo em estado LIVRE
  useEffect(() => {
    if (!isLoggedIn || !isWorking) {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      setSpeed(0);
      return;
    }

    if (!navigator.geolocation) {
      setErrorMsg("GPS Não suportado.");
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed: geoSpeed, accuracy } = pos.coords;
        const now = Date.now();
        
        // FILTRO DE PRECISÃO: Ignora sinais com baixa precisão (> 30m) para evitar oscilações
        if (accuracy && accuracy > 30) return;

        let rawSpeedKmh = (geoSpeed || 0) * 3.6;

        if (lastPos.current) {
          const d = getDistance(lastPos.current.lat, lastPos.current.lon, latitude, longitude);
          const timeDiffSeconds = (now - lastPos.current.time) / 1000;
          
          if (geoSpeed === null || geoSpeed === 0) {
            const timeDiffHours = timeDiffSeconds / 3600; 
            if (timeDiffHours > 0) rawSpeedKmh = d / timeDiffHours;
          }

          // Filtro de Velocidade Irreal (Acima de 220 km/h)
          if (rawSpeedKmh > 220) rawSpeedKmh = speed; 

          // Filtro de Média Móvel para Estabilidade
          speedHistory.current.push(rawSpeedKmh);
          if (speedHistory.current.length > 5) speedHistory.current.shift();
          const avgSpeed = speedHistory.current.reduce((a, b) => a + b, 0) / speedHistory.current.length;
          
          // ESTABILIDADE: Se a velocidade média for inferior a 1.5 km/h, consideramos o veículo parado
          const stableSpeed = avgSpeed < 1.5 ? 0 : avgSpeed;
          setSpeed(stableSpeed);
          
          checkRadars(latitude, longitude, stableSpeed);

          // Lógica de Acúmulo e Reset por Movimento
          const currentStatus = tripStatusRef.current;
          const isSignificantMovement = avgSpeed > 2.0 && d > 0.002;

          if (isSignificantMovement || (timeDiffSeconds > 5 && d > 0.05)) {
            if (currentStatus === 'running') {
              // Se houve um gap grande (ex: app em background), aplicamos a distância proporcional
              if (avgSpeed >= rates.speedThreshold) {
                distanceCounter.current += d;
                updateTripTickRef.current(0); // Força verificação de pulsos de distância
              }
              setTrip(prev => ({ ...prev, distance: prev.distance + d }));
            } else if (currentStatus === 'finalizing') {
              finalizingDistanceCounter.current += d;
              if (finalizingDistanceCounter.current >= 0.2) {
                resetToStopped();
              }
            }
          }
        }
 else {
          // Primeira captura: define velocidade inicial se disponível
          if (geoSpeed !== null) {
            const initialSpeed = geoSpeed * 3.6;
            setSpeed(initialSpeed);
            speedHistory.current = [initialSpeed];
          }
        }
        
        lastPos.current = { lat: latitude, lon: longitude, time: now };
      },
      (err) => { 
        setErrorMsg("Sinal de GPS Fraco."); 
      },
      { 
        enableHighAccuracy: true,
        maximumAge: 500,
        timeout: 5000
      }
    );

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [isLoggedIn, isWorking, rates.speedThreshold, checkRadars, resetToStopped]);

  const startTrip = () => {
    if (!isLoggedIn || !isWorking) {
      setErrorMsg("ACESSO NEGADO: ATIVE O TX1 COPILOT NO ÍCONE ACIMA PARA INICIAR.");
      setIsChatOpen(true);
      return;
    }

    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }

    // Reset metrológico rigoroso
    internalFareRef.current = rates.baseFare;
    distanceCounter.current = 0;
    timeCounter.current = 0;
    finalizingDistanceCounter.current = 0;
    lastPos.current = null;

    requestWakeLock();
    setTrip({
      id: Math.random().toString(36).substr(2, 9),
      startTime: Date.now(),
      distance: 0,
      fare: rates.baseFare,
      status: 'running',
      currentFlag: getActiveFlag()
    });
    setDuration(0);
    setErrorMsg(null);
  };

  const stopTrip = () => {
    releaseWakeLock();
    
    // Captura o valor final IMEDIATAMENTE do acumulador metrológico
    const finalFare = internalFareRef.current;

    setTrip(prev => ({ 
      ...prev, 
      status: 'finalizing', 
      fare: finalFare,
      endTime: Date.now() 
    }));
    
    // Zera contadores para evitar qualquer acúmulo residual no estado de PAGAR
    distanceCounter.current = 0;
    timeCounter.current = 0;
    finalizingDistanceCounter.current = 0;
    lastPos.current = null;

    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    resetTimeoutRef.current = setTimeout(resetToStopped, 20000);
  };

  const handleSaveRates = (newRates: TaximeterRates) => {
    setRates(newRates);
    localStorage.setItem(STORAGE_KEYS.RATES, JSON.stringify(newRates));
    setIsSettingsOpen(false);
    if (trip.status === 'stopped') setTrip(prev => ({...prev, fare: 0}));
  };

  const handleSaveDriver = (newDriver: DriverInfo) => {
    setDriverInfo(newDriver);
    localStorage.setItem(STORAGE_KEYS.DRIVER, JSON.stringify(newDriver));
  };

  const handleLoginSuccess = (name: string) => {
    setIsLoggedIn(true);
    handleSaveDriver({ ...driverInfo, name: name });
    setErrorMsg(null);
  };

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setIsWorking(false);
    const resetDriver = { name: 'TX - Motorista', isPro: false };
    setDriverInfo(resetDriver);
    localStorage.setItem(STORAGE_KEYS.DRIVER, JSON.stringify(resetDriver));
    
    // Reset total do taxímetro ao deslogar
    setTrip({
      id: '',
      startTime: 0,
      distance: 0,
      fare: 0,
      status: 'stopped',
      currentFlag: 1
    });
    setDuration(0);
    internalFareRef.current = 0;
    distanceCounter.current = 0;
    timeCounter.current = 0;
    finalizingDistanceCounter.current = 0;
    lastPos.current = null;
    
    setShowSplash(true);
  };

  if (showSplash) return <SplashScreen onComplete={handleSplashComplete} />;

  return (
    <div className="h-screen bg-black flex flex-col items-center pt-14 overflow-hidden">
      <header className="w-full max-w-7xl px-4 sm:px-8 flex justify-between items-center mb-4 md:mb-6 shrink-0">
        <Logo className="w-auto" showSubtitle={false} isHeader={true} />
        <div className="flex items-center gap-3 md:gap-6">
            <div className="flex flex-col items-end">
                <span className="text-[7px] sm:text-[9px] font-black text-white/40 tracking-widest uppercase">{APP_INFO.MODEL}</span>
                <span className="text-[5px] sm:text-[7px] font-bold text-yellow-500/60 uppercase">{APP_INFO.VERSION}</span>
            </div>
            <div className="w-px h-6 sm:h-8 bg-white/10"></div>
            <button 
                onClick={() => setIsSettingsOpen(true)}
                className="w-8 h-8 sm:w-9 sm:h-9 bg-[#111] rounded-xl flex items-center justify-center text-white/40 hover:text-yellow-500 border border-white/5"
            >
                <i className="fa-solid fa-sliders text-[10px] sm:text-xs"></i>
            </button>
        </div>
      </header>

      {errorMsg && (
        <div className="mx-6 mb-4 max-w-lg bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-2xl flex items-center gap-3 animate-pulse shrink-0">
          <i className="fa-solid fa-triangle-exclamation text-[10px]"></i>
          <p className="text-[9px] font-black uppercase tracking-widest">{errorMsg}</p>
        </div>
      )}

      <main className="w-full flex-1 flex flex-col items-center justify-start lg:justify-center pb-16 sm:pb-20 px-2 sm:px-4 overflow-hidden">
        <TaximeterDisplay 
          fare={trip.fare}
          distance={trip.distance}
          duration={duration}
          speed={speed}
          status={trip.status}
          speedThreshold={rates.speedThreshold}
          currentFlag={trip.currentFlag}
          rates={rates}
          isPro={driverInfo.isPro}
          onActivatePro={() => handleSaveDriver({ ...driverInfo, isPro: true })}
          isLoggedIn={isLoggedIn}
          isWorking={isWorking}
          setIsWorking={setIsWorking}
          onLoginSuccess={handleLoginSuccess}
          onLogout={handleLogout}
          isOpen={isChatOpen}
          setIsOpen={setIsChatOpen}
        />
      </main>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-[60]">
        {trip.status === 'running' ? (
          <button 
            onClick={stopTrip}
            className="w-full bg-red-600 text-white font-black py-3.5 sm:py-4 rounded-[20px] sm:rounded-[24px] uppercase tracking-[0.2em] text-[10px] sm:text-[11px] flex items-center justify-center gap-3 transition-colors cursor-pointer"
          >
            <i className="fa-solid fa-stop text-sm sm:text-base"></i>
            ENCERRAR CORRIDA
          </button>
        ) : (
          <button 
            onClick={trip.status === 'finalizing' ? undefined : startTrip}
            className={`w-full ${trip.status === 'finalizing' ? 'bg-yellow-500 opacity-60' : 'bg-yellow-500 cursor-pointer'} text-black font-black py-3.5 sm:py-4 rounded-[20px] sm:rounded-[24px] uppercase tracking-[0.2em] text-[10px] sm:text-[11px] flex items-center justify-center gap-3 transition-all`}
          >
            <i className="fa-solid fa-play text-sm sm:text-base"></i>
            INICIAR NOVA VIAGEM
          </button>
        )}
      </div>

      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        rates={rates}
        onSave={handleSaveRates}
        driverInfo={driverInfo}
        onSaveDriver={handleSaveDriver}
        reports={radarReports}
        onLogout={handleLogout}
      />
    </div>
  );
};

export default App;
