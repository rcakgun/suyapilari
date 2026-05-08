import React, { useState, useEffect, useRef } from 'react';
import { Map, Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { db } from './firebase'; 
import { collection, addDoc, getDocs, updateDoc, doc, query, where } from "firebase/firestore";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const YAPI_KATALOGU = {
  'Çeşme': '⛲', 'Sebil': '🏺', 'Sarnıç': '🏛️', 'Hamam': '🧼', 'Su Kemeri': '🌉',
  'Maksem': '🛖', 'Ayazma': '💧', 'Şadırvan': '⛲', 'Bent': '🌊', 'Su Terazisi': '🗼'
};

const BOZULMA_DURUMLARI = ['İyi', 'Orta', 'Kötü'];
const MALZEME_TURLERI = ['Taş', 'Tuğla', 'Ahşap', 'Mermer', 'Metal', 'Beton', 'Harç'];
const BOZULMA_TURLERI = ['Çatlak', 'Kırık', 'Eksilme', 'Bitkilenme', 'Renk Değişimi', 'Kirlenme', 'Aşınma'];

export default function App() {
  // --- STATES ---
  const [viewState, setViewState] = useState({ longitude: 28.97, latitude: 41.01, zoom: 14 });
  const [currentUser, setCurrentUser] = useState(null); 
  const [allUsers, setAllUsers] = useState([]); 
  const [allStructures, setAllStructures] = useState([]); 
  const [pendingStructures, setPendingStructures] = useState([]); 
  const [activeFiltreler, setAktifFiltreler] = useState(Object.keys(YAPI_KATALOGU));

  const [activeTab, setActiveTab] = useState('map');
  const [modalMode, setModalMode] = useState(null); 
  const [secilenNokta, setSecilenNokta] = useState(null);
  const [adres, setAdres] = useState("");
  const [aramaMetni, setAramaMetni] = useState("");
  const [oneriler, setOneriler] = useState([]);
  const [detayYapi, setDetayYapi] = useState(null);
  const [zoomPhoto, setZoomPhoto] = useState(null); 

  const mapRef = useRef(null);

  // --- FIREBASE: VERI CEKME ---
  useEffect(() => {
    const verileriGetir = async () => {
      try {
        // Kullanıcıları Çek
        const userSnapshot = await getDocs(collection(db, "users"));
        const userListesi = [];
        userSnapshot.forEach((doc) => {
          userListesi.push({ id: doc.id, ...doc.data() });
        });
        setAllUsers(userListesi);

        // Yapıları Çek (Sayfa Yenilenince Gitmemesi İçin)
        const structSnapshot = await getDocs(collection(db, "structures"));
        const structListesi = [];
        structSnapshot.forEach((doc) => {
          structListesi.push({ id: doc.id, ...doc.data() });
        });
        setAllStructures(structListesi.filter(s => s.status === 'active'));
        setPendingStructures(structListesi.filter(s => s.status === 'pending'));

      } catch (e) { console.error("Veri hatası:", e); }
    };
    verileriGetir();
  }, [activeTab]);

  // --- KAYIT OL (Mükerrer Kontrolü Dahil) ---
  const handleRegister = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email');

    try {
      const q = query(collection(db, "users"), where("email", "==", email));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) return alert("Bu e-posta adresi ile zaten bir başvuru mevcut!");

      const photoFile = fd.get('kimlikFoto');
      const reader = new FileReader();
      reader.onloadend = async () => {
        await addDoc(collection(db, "users"), {
          adSoyad: fd.get('adSoyad'),
          email: email,
          sifre: fd.get('sifre'),
          ogrenciNo: fd.get('ogrenciNo'),
          kimlikFoto: reader.result, 
          role: 'member',
          status: 'pending',
          kayitTarihi: new Date().toISOString()
        });
        setModalMode(null);
        alert("Başvurunuz kaydedildi. Yönetici onayı bekleyin.");
      };
      if (photoFile) reader.readAsDataURL(photoFile);
    } catch (error) { alert("Hata: " + error.message); }
  };

  // --- GİRİŞ YAP ---
  const handleLogin = async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const sifre = document.getElementById('loginPass').value;

    if (email === 'admin@site.com' && sifre === 'Admin123') {
      setCurrentUser({ adSoyad: 'Site Sahibi', role: 'admin', status: 'active', email: 'admin@site.com' });
      setModalMode(null);
      return;
    }

    try {
      const q = query(collection(db, "users"), where("email", "==", email), where("sifre", "==", sifre));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return alert("Hatalı bilgiler!");
      const userData = querySnapshot.docs[0].data();
      if (userData.status === 'pending') return alert("Hesabınız henüz onaylanmadı.");
      setCurrentUser({ id: querySnapshot.docs[0].id, ...userData });
      setModalMode(null);
    } catch (error) { console.error(error); }
  };

  // --- ÜYEYİ ONAYLA ---
  const handleApproveUser = async (userId) => {
    try {
      const userRef = doc(db, "users", userId);
      await updateDoc(userRef, { status: 'active' });
      setAllUsers(prev => prev.map(u => u.id === userId ? {...u, status: 'active'} : u));
      alert("Üye aktif edildi!");
    } catch (error) { alert(error.message); }
  };

  // --- YAPI EKLEME (FIREBASE VE YENİ ALANLAR) ---
  const handleAddStructure = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const files = Array.from(e.target.fotos.files); 
    const photoPromises = files.map(file => new Promise(res => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.readAsDataURL(file);
    }));

    Promise.all(photoPromises).then(async (base64Photos) => {
      const newS = {
        ad: fd.get('ad'),
        tur: fd.get('tur'),
        yil: fd.get('yil'),
        bilgi: fd.get('bilgi'),
        bozulmaDurumu: fd.get('bozulmaDurumu'),
        malzemeTuru: fd.getAll('malzemeTuru'),
        bozulmaTuru: fd.getAll('bozulmaTuru'),
        koordinat: secilenNokta,
        adres,
        ekleyen: currentUser.email,
        ekleyenAd: currentUser.adSoyad,
        fotolar: base64Photos,
        status: 'pending'
      };

      try {
        const docRef = await addDoc(collection(db, "structures"), newS);
        newS.id = docRef.id;
        setPendingStructures([...pendingStructures, newS]);
        setModalMode(null);
        alert("Yapı onaya gönderildi.");
      } catch (err) {
        console.error("Yapı eklenirken hata: ", err);
      }
    });
  };

  // --- YAPI GÜNCELLEME (FIREBASE VE YENİ ALANLAR) ---
  const handleEditStructure = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const files = Array.from(e.target.fotos.files); 
    
    const applyUpdate = async (base64Photos) => {
      const now = new Date();
      const timeStr = now.toLocaleDateString('tr-TR') + " " + now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      
      const updatedStructure = {
        ...detayYapi,
        ad: fd.get('ad'),
        tur: fd.get('tur'),
        yil: fd.get('yil'),
        bilgi: fd.get('bilgi'),
        bozulmaDurumu: fd.get('bozulmaDurumu'),
        malzemeTuru: fd.getAll('malzemeTuru'),
        bozulmaTuru: fd.getAll('bozulmaTuru'),
        lastUpdatedBy: currentUser.adSoyad,
        lastUpdatedDate: timeStr
      };

      if (base64Photos.length > 0) {
        updatedStructure.fotolar = [...(detayYapi.fotolar || []), ...base64Photos];
      }

      try {
        await updateDoc(doc(db, "structures", detayYapi.id), updatedStructure);
        setAllStructures(prev => prev.map(s => s.id === detayYapi.id ? updatedStructure : s));
        setPendingStructures(prev => prev.map(s => s.id === detayYapi.id ? updatedStructure : s));
        setDetayYapi(updatedStructure);
        setModalMode('viewDetail');
        alert("Yapı bilgileri başarıyla güncellendi!");
      } catch (err) {
        console.error("Güncelleme hatası: ", err);
      }
    };

    if (files.length > 0 && files[0].name !== "") {
      const photoPromises = files.map(file => new Promise(res => {
        const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file);
      }));
      Promise.all(photoPromises).then(applyUpdate);
    } else {
      applyUpdate([]);
    }
  };

  // --- FOTOĞRAF SİLME (ADMİN İÇİN) ---
  const handleDeletePhoto = async (indexToRemove) => {
    if (!window.confirm("Bu fotoğrafı silmek istediğinize emin misiniz?")) return;

    const yeniFotolar = [...detayYapi.fotolar];
    yeniFotolar.splice(indexToRemove, 1);

    const updatedStructure = { ...detayYapi, fotolar: yeniFotolar };

    try {
      await updateDoc(doc(db, "structures", detayYapi.id), { fotolar: yeniFotolar });
      setDetayYapi(updatedStructure);
      setAllStructures(prev => prev.map(s => s.id === detayYapi.id ? updatedStructure : s));
      setPendingStructures(prev => prev.map(s => s.id === detayYapi.id ? updatedStructure : s));
    } catch (err) {
      console.error("Silme hatası: ", err);
    }
  };

  // --- ARAMA ---
  useEffect(() => {
    if (aramaMetni.length < 3) return;
    const t = setTimeout(async () => {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(aramaMetni)}&format=json&countrycodes=tr&limit=5`);
      const data = await res.json();
      setOneriler(data);
    }, 400);
    return () => clearTimeout(t);
  }, [aramaMetni]);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#fdfdfd', fontFamily: 'sans-serif' }}>
      
      {/* --- NAV --- */}
      <nav style={navStyle}>
        <div style={{ fontWeight: '800', fontSize: '1.2rem', color: '#1e40af' }}>SU MİMARİSİ <span style={{fontWeight: '300'}}>ARŞİVİ</span></div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <button onClick={() => setActiveTab('map')} style={menuItem(activeTab === 'map')}>Harita</button>
          {currentUser && <button onClick={() => setActiveTab('profile')} style={menuItem(activeTab === 'profile')}>Profilim</button>}
          {currentUser?.role === 'admin' && <button onClick={() => setActiveTab('admin')} style={{...menuItem(activeTab === 'admin'), color: '#dc2626'}}>Yönetim</button>}
          <div style={{ height: '20px', width: '1px', background: '#ddd' }}></div>
          {!currentUser ? (
            <div style={{display: 'flex', gap: '10px'}}>
              <button onClick={() => setModalMode('login')} style={loginBtn}>Giriş</button>
              <button onClick={() => setModalMode('register')} style={registerBtn}>Üye Ol</button>
            </div>
          ) : (
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <span style={{fontSize: '0.8rem', fontWeight: 'bold'}}>{currentUser.adSoyad}</span>
              <button onClick={() => { setCurrentUser(null); setActiveTab('map'); }} style={logoutBtn}>Çıkış</button>
            </div>
          )}
        </div>
      </nav>

      {/* --- ANA ALAN --- */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        
        {activeTab === 'map' && (
          <>
            <Map
              {...viewState}
              ref={mapRef}
              onMove={evt => setViewState(evt.viewState)}
              mapStyle="mapbox://styles/mapbox/streets-v12"
              mapboxAccessToken={MAPBOX_TOKEN}
              onLoad={(e) => {
                const map = e.target;
                map.getStyle().layers.forEach((layer) => {
                  if (layer.layout && layer.layout['text-field']) {
                    map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name_tr'], ['get', 'name']]);
                  }
                });
              }}
              onClick={async (e) => {
                const { lng, lat } = e.lngLat;
                setSecilenNokta({ lng, lat });
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
                const d = await res.json();
                setAdres(d.display_name);
              }}
            >
              {allStructures.filter(s => activeFiltreler.includes(s.tur)).map(s => (
                <Marker key={s.id} longitude={s.koordinat.lng} latitude={s.koordinat.lat}>
                  <div onClick={(e) => { e.stopPropagation(); setDetayYapi(s); setModalMode('viewDetail'); }} style={{ fontSize: '28px', cursor: 'pointer' }}>
                    {YAPI_KATALOGU[s.tur]}
                  </div>
                </Marker>
              ))}
              {secilenNokta && <Marker longitude={secilenNokta.lng} latitude={secilenNokta.lat} color="#ef4444" />}
            </Map>

            {/* ARAMA */}
            <div style={{ position: 'absolute', top: 20, left: 20, width: '320px', zIndex: 10 }}>
              <input type="text" placeholder="Yapı veya semt ara..." value={aramaMetni} onChange={e => setAramaMetni(e.target.value)} style={searchInput} />
              {oneriler.length > 0 && (
                <div style={searchList}>
                  {oneriler.map((o, i) => (
                    <div key={i} onClick={() => {
                      const lat = parseFloat(o.lat); const lon = parseFloat(o.lon);
                      mapRef.current?.flyTo({ center: [lon, lat], zoom: 17 });
                      setSecilenNokta({ lng: lon, lat });
                      setOneriler([]);
                    }} style={searchItem}>{o.display_name}</div>
                  ))}
                </div>
              )}
            </div>

            {/* FİLTRELER */}
            <div style={filterPanel}>
              <div style={{fontSize: '0.7rem', fontWeight: '800', color: '#94a3b8', marginBottom: '10px'}}>KOLEKSİYON</div>
              {Object.keys(YAPI_KATALOGU).map(t => (
                <label key={t} style={filterItem}>
                  <input type="checkbox" checked={activeFiltreler.includes(t)} onChange={() => setAktifFiltreler(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])} />
                  <span>{YAPI_KATALOGU[t]} {t}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {activeTab === 'admin' && (
          <div style={contentPage}>
            <h2 style={{color: '#1e40af', marginBottom: '30px'}}>Yönetim Paneli</h2>
            
            <h3 style={sectionTitle}>Bekleyen Üye Başvuruları</h3>
            <div style={adminGrid}>
              {allUsers.filter(u => u.status === 'pending').map(u => (
                <div key={u.id} style={adminCard}>
                  <div style={{display: 'flex', gap: '12px'}}>
                    <img src={u.kimlikFoto} onClick={() => setZoomPhoto(u.kimlikFoto)} style={compactImg} alt="Kimlik" />
                    <div style={{flex: 1}}>
                      <p style={{margin: '0 0 4px 0', fontWeight: 'bold', fontSize: '0.85rem'}}>{u.adSoyad}</p>
                      <p style={{fontSize: '0.7rem', color: '#666', margin: '0 0 8px 0'}}>{u.email} <br/> No: {u.ogrenciNo}</p>
                      <button onClick={() => handleApproveUser(u.id)} style={approveBtnMini}>Onayla</button>
                    </div>
                  </div>
                </div>
              ))}
              {allUsers.filter(u => u.status === 'pending').length === 0 && <p style={{color: '#94a3b8'}}>Bekleyen üye başvurusu yok.</p>}
            </div>

            <hr style={{margin: '40px 0', border: 'none', borderTop: '1px solid #e2e8f0'}} />

            {/* YÖNETİCİ - ONAY BEKLEYEN YAPILAR */}
            <h3 style={sectionTitle}>Onay Bekleyen Yapılar</h3>
            <div style={adminGrid}>
              {pendingStructures.map(s => (
                <div key={s.id} style={adminCard}>
                  <p style={{margin: '0 0 5px 0', fontWeight: 'bold', color: '#1e40af'}}>{s.ad}</p>
                  <p style={{fontSize: '0.8rem', color: '#666', margin: '0 0 5px 0'}}>{s.tur} {s.yil && `• ${s.yil}`}</p>
                  <p style={{fontSize: '0.8rem', lineHeight: '1.5', maxHeight: '100px', overflowY: 'auto', marginBottom: '10px'}}>{s.bilgi}</p>
                  
                  {s.fotolar && s.fotolar.length > 0 && (
                    <div style={{display: 'flex', gap: '8px', overflowX: 'auto', padding: '10px 0', borderTop: '1px solid #f1f5f9'}}>
                      {s.fotolar.map((img, i) => (
                        <img key={i} src={img} onClick={() => setZoomPhoto(img)} style={{height: '60px', borderRadius: '5px', cursor: 'zoom-in'}} alt="Yapı" />
                      ))}
                    </div>
                  )}

                  <div style={{display: 'flex', gap: '5px', marginTop: '10px'}}>
                    <button onClick={() => { setDetayYapi(s); setModalMode('editStructure'); }} style={{...approveBtnMini, flex: 1, background: '#3b82f6'}}>İncele / Düzenle</button>
                    <button 
                      onClick={async () => {
                        await updateDoc(doc(db, "structures", s.id), { status: 'active' });
                        setAllStructures([...allStructures, {...s, status: 'active'}]);
                        setPendingStructures(pendingStructures.filter(x => x.id !== s.id));
                        alert("Yapı haritaya eklendi!");
                      }} 
                      style={{...approveBtnMini, flex: 1}}
                    >
                      Onayla
                    </button>
                  </div>
                </div>
              ))}
              {pendingStructures.length === 0 && <p style={{color: '#94a3b8'}}>Onay bekleyen yapı yok.</p>}
            </div>

            <hr style={{margin: '40px 0', border: 'none', borderTop: '1px solid #e2e8f0'}} />

            <h3 style={sectionTitle}>Kabul Edilen Üyeler</h3>
            <div style={adminGrid}>
              {allUsers.filter(u => u.status === 'active' && u.role !== 'admin').map(u => (
                <div key={u.id} style={{...adminCard, opacity: 0.85, padding: '12px'}}>
                   <p style={{margin: '0 0 4px 0', fontWeight: 'bold', fontSize: '0.85rem'}}>{u.adSoyad}</p>
                   <p style={{fontSize: '0.7rem', color: '#64748b'}}>{u.email} - No: {u.ogrenciNo}</p>
                   <span style={{fontSize: '0.6rem', color: '#10b981', fontWeight: 'bold'}}>● AKTİF ÜYE</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div style={contentPage}>
            <h2>Eklediğim Yapılar</h2>
            <div style={adminGrid}>
              {allStructures.concat(pendingStructures).filter(s => s.ekleyen === currentUser.email).map(s => (
                <div key={s.id} style={adminCard}>
                  <h4>{s.ad}</h4>
                  <span style={{fontSize: '0.7rem', padding: '5px 10px', borderRadius: '8px', background: s.status === 'active' ? '#dcfce7' : '#fef9c3'}}>
                    {s.status === 'active' ? 'YAYINDA' : 'ONAY BEKLİYOR'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* --- MODALLAR --- */}
      {modalMode && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <button onClick={() => setModalMode(null)} style={closeBtn}>✕</button>
            
            {modalMode === 'login' && (
              <div style={{width: '100%'}}>
                <h3 style={{marginBottom: '20px'}}>Sisteme Giriş</h3>
                <input id="loginEmail" placeholder="E-posta" style={fIn} />
                <input id="loginPass" type="password" placeholder="Şifre" style={fIn} />
                <button onClick={handleLogin} style={actionBtn}>Giriş Yap</button>
              </div>
            )}

            {modalMode === 'register' && (
              <form onSubmit={handleRegister} style={{width: '100%'}}>
                <h3 style={{marginBottom: '20px'}}>Yeni Üye Başvurusu</h3>
                <input required name="adSoyad" placeholder="Ad Soyad" style={fIn} />
                <input required name="email" type="email" placeholder="E-posta" style={fIn} />
                <input required name="sifre" type="password" placeholder="Şifre" style={fIn} />
                <input required name="ogrenciNo" placeholder="Öğrenci No" style={fIn} />
                <label style={{fontSize: '0.7rem', color: '#666', display: 'block', marginBottom: '5px'}}>Öğrenci Kimliği:</label>
                <input required name="kimlikFoto" type="file" style={fIn} />
                <button style={actionBtn}>Başvuruyu Gönder</button>
              </form>
            )}

            {modalMode === 'addStructure' && (
              <form onSubmit={handleAddStructure} style={{width: '100%'}}>
                <h3>Yeni Yapı Ekle</h3>
                <input required name="ad" placeholder="Yapı Adı" style={fIn} />
                <div style={{display: 'flex', gap: '10px'}}>
                  <select name="tur" style={{...fIn, flex: 1}}>
                    {Object.keys(YAPI_KATALOGU).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select name="bozulmaDurumu" style={{...fIn, flex: 1}} required>
                    <option value="" disabled selected>Bozulma Durumu</option>
                    {BOZULMA_DURUMLARI.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                
                <label style={checkTitle}>Malzeme Türü:</label>
                <div style={checkGroup}>
                  {MALZEME_TURLERI.map(m => (
                    <label key={m} style={checkItem}><input type="checkbox" name="malzemeTuru" value={m} /> {m}</label>
                  ))}
                </div>

                <label style={checkTitle}>Bozulma Türü:</label>
                <div style={checkGroup}>
                  {BOZULMA_TURLERI.map(b => (
                    <label key={b} style={checkItem}><input type="checkbox" name="bozulmaTuru" value={b} /> {b}</label>
                  ))}
                </div>

                <input name="yil" placeholder="Yapım Yılı / Dönemi (Örn: 1720)" style={fIn} />
                <textarea required name="bilgi" placeholder="Yapı Hakkında Detaylı Bilgi" style={{...fIn, height: '80px'}} />
                <label style={{fontSize: '0.7rem', color: '#666', display: 'block', marginBottom: '5px'}}>Yapı Fotoğrafları:</label>
                <input required name="fotos" type="file" multiple style={fIn} />
                <button type="submit" style={actionBtn}>Onaya Gönder</button>
              </form>
            )}

            {/* DÜZENLEME MODALI */}
            {modalMode === 'editStructure' && detayYapi && (
              <form onSubmit={handleEditStructure} style={{width: '100%'}}>
                <h3>Yapı Bilgilerini Güncelle</h3>
                <input required name="ad" defaultValue={detayYapi.ad} placeholder="Yapı Adı" style={fIn} />
                
                <div style={{display: 'flex', gap: '10px'}}>
                  <select name="tur" defaultValue={detayYapi.tur} style={{...fIn, flex: 1}}>
                    {Object.keys(YAPI_KATALOGU).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select name="bozulmaDurumu" defaultValue={detayYapi.bozulmaDurumu} style={{...fIn, flex: 1}} required>
                    <option value="" disabled>Bozulma Durumu</option>
                    {BOZULMA_DURUMLARI.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <label style={checkTitle}>Malzeme Türü:</label>
                <div style={checkGroup}>
                  {MALZEME_TURLERI.map(m => (
                    <label key={m} style={checkItem}>
                      <input type="checkbox" name="malzemeTuru" value={m} defaultChecked={detayYapi.malzemeTuru?.includes(m)} /> {m}
                    </label>
                  ))}
                </div>

                <label style={checkTitle}>Bozulma Türü:</label>
                <div style={checkGroup}>
                  {BOZULMA_TURLERI.map(b => (
                    <label key={b} style={checkItem}>
                      <input type="checkbox" name="bozulmaTuru" value={b} defaultChecked={detayYapi.bozulmaTuru?.includes(b)} /> {b}
                    </label>
                  ))}
                </div>

                <input name="yil" defaultValue={detayYapi.yil} placeholder="Yapım Yılı / Dönemi" style={fIn} />
                <textarea required name="bilgi" defaultValue={detayYapi.bilgi} placeholder="Yapı Hakkında Detaylı Bilgi" style={{...fIn, height: '80px'}} />
                
                {/* Admin veya normal kullanıcı fotoğraf silme / ekleme ekranı */}
                <label style={{fontSize: '0.7rem', color: '#666', display: 'block', marginBottom: '5px'}}>Mevcut Fotoğraflar (Admin iseniz silebilirsiniz):</label>
                <div style={{display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: '15px'}}>
                  {detayYapi.fotolar?.map((img, i) => (
                    <div key={i} style={{position: 'relative', display: 'inline-block'}}>
                      <img src={img} style={{height: '60px', borderRadius: '5px', objectFit: 'cover'}} alt="Yapı" />
                      {currentUser?.role === 'admin' && (
                        <button type="button" onClick={() => handleDeletePhoto(i)} style={{position: 'absolute', top: '-5px', right: '-5px', background: 'red', color: 'white', borderRadius: '50%', border: 'none', width: '20px', height: '20px', cursor: 'pointer', fontSize: '10px'}}>✕</button>
                      )}
                    </div>
                  ))}
                </div>

                <label style={{fontSize: '0.7rem', color: '#666', display: 'block', marginBottom: '5px'}}>Yeni Fotoğraflar Ekle (İsteğe Bağlı):</label>
                <input name="fotos" type="file" multiple style={fIn} />
                <button type="submit" style={actionBtn}>Güncellemeyi Kaydet</button>
              </form>
            )}

            {/* YAPI DETAYI (GALERİ, DÜZENLE BUTONU VE STREET VIEW ERROR ÇÖZÜMÜ) */}
            {modalMode === 'viewDetail' && detayYapi && (
              <div style={{width: '100%'}}>
                <h2 style={{margin: '0 0 10px 0', color: '#1e40af'}}>{detayYapi.ad}</h2>
                <p style={{fontSize: '0.9rem', color: '#666', marginBottom: '15px'}}>{detayYapi.tur} {detayYapi.yil && `• ${detayYapi.yil}`}</p>
                
                {/* YENİ ALANLARIN GÖSTERİMİ */}
                <div style={{display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px'}}>
                  {detayYapi.bozulmaDurumu && <span style={tagStyle}><strong>Durum:</strong> {detayYapi.bozulmaDurumu}</span>}
                  {detayYapi.malzemeTuru?.length > 0 && <span style={tagStyle}><strong>Malzeme:</strong> {detayYapi.malzemeTuru.join(', ')}</span>}
                  {detayYapi.bozulmaTuru?.length > 0 && <span style={tagStyle}><strong>Bozulma:</strong> {detayYapi.bozulmaTuru.join(', ')}</span>}
                </div>

                <p style={{lineHeight: '1.6', fontSize: '0.95rem', maxHeight: '150px', overflowY: 'auto'}}>{detayYapi.bilgi}</p>
                
                {/* GALERİ */}
                <div style={{display: 'flex', gap: '10px', overflowX: 'auto', padding: '10px 0', borderBottom: '1px solid #eee'}}>
                  {detayYapi.fotolar?.map((img, i) => <img key={i} src={img} onClick={() => setZoomPhoto(img)} style={{height: '100px', borderRadius: '8px', cursor: 'zoom-in'}} alt="Yapı" />)}
                </div>

                {/* DENETİM İZİ (KİM GÜNCELLEDİ?) */}
                {(detayYapi.lastUpdatedBy || detayYapi.ekleyenAd || detayYapi.ekleyen) && (
                  <div style={{marginTop: '15px', padding: '10px', background: '#f8fafc', borderRadius: '8px', borderLeft: '3px solid #10b981', fontSize: '0.75rem', color: '#475569'}}>
                    <strong>Son Güncelleyen:</strong> {detayYapi.lastUpdatedBy || detayYapi.ekleyenAd || (detayYapi.ekleyen ? detayYapi.ekleyen.split('@')[0] : 'Gizli Kullanıcı')} <br/>
                    <strong>Tarih:</strong> {detayYapi.lastUpdatedDate || "Orijinal Kayıt"}
                  </div>
                )}

                <div style={{display: 'flex', gap: '10px', marginTop: '15px'}}>
                  <button onClick={() => window.open(`https://www.google.com/maps?layer=c&cbll=${detayYapi.koordinat.lat},${detayYapi.koordinat.lng}`, '_blank')} style={{...streetBtn, marginTop: 0, flex: 1}}>
                    📷 Street View
                  </button>
                  {currentUser && currentUser.status === 'active' && (
                    <button onClick={() => setModalMode('editStructure')} style={{...streetBtn, marginTop: 0, flex: 1, background: '#1e40af'}}>
                      ✏️ Düzenle / Fotoğraf Ekle
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {zoomPhoto && (
        <div onClick={() => setZoomPhoto(null)} style={{...modalOverlay, background: 'rgba(0,0,0,0.92)', zIndex: 3000}}>
          <img src={zoomPhoto} style={{maxHeight: '90vh', maxWidth: '90vw', borderRadius: '10px', boxShadow: '0 0 50px rgba(0,0,0,0.5)'}} alt="Zoom" />
        </div>
      )}

      {secilenNokta && activeTab === 'map' && !modalMode && (
        <div style={infoBox}>
          <p style={{fontSize: '0.75rem', color: '#64748b', marginBottom: '12px'}}>{adres}</p>
          <div style={{display: 'flex', gap: '10px'}}>
            <button onClick={() => window.open(`https://www.google.com/maps?layer=c&cbll=${secilenNokta.lat},${secilenNokta.lng}`, '_blank')} style={{...miniBtn, background: '#334155'}}>📷 Sokak</button>
            <button disabled={!currentUser || currentUser.status === 'pending'} onClick={() => setModalMode('addStructure')} style={{...miniBtn, background: (!currentUser || currentUser.status === 'pending') ? '#ccc' : '#10b981'}}>
              {!currentUser ? "Giriş Yapın" : "➕ Yapı Ekle"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- STİLLER ---
const navStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 30px', background: 'white', borderBottom: '1px solid #e2e8f0', zIndex: 100 };
const menuItem = (active) => ({ background: 'transparent', border: 'none', color: active ? '#1e40af' : '#64748b', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' });
const loginBtn = { padding: '8px 20px', borderRadius: '10px', border: '1px solid #1e40af', color: '#1e40af', background: 'white', fontWeight: 'bold', cursor: 'pointer' };
const registerBtn = { padding: '8px 20px', borderRadius: '10px', border: 'none', background: '#1e40af', color: 'white', fontWeight: 'bold', cursor: 'pointer' };
const logoutBtn = { background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 15px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' };
const searchInput = { width: '100%', padding: '15px', borderRadius: '15px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', outline: 'none', boxSizing: 'border-box' };
const searchList = { background: 'white', marginTop: '5px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', overflow: 'hidden' };
const searchItem = { padding: '12px', fontSize: '0.8rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' };
const filterPanel = { position: 'absolute', top: 20, right: 20, background: 'white', padding: '20px', borderRadius: '20px', boxShadow: '0 4px 30px rgba(0,0,0,0.05)', width: '160px' };
const filterItem = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#475569', marginBottom: '8px', cursor: 'pointer' };
const modalOverlay = { position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 };
const modalBox = { background: 'white', padding: '40px', borderRadius: '30px', width: '450px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 25px 50px rgba(0,0,0,0.15)', boxSizing: 'border-box' };
const fIn = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '15px', outline: 'none', boxSizing: 'border-box' };
const actionBtn = { width: '100%', padding: '15px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', boxSizing: 'border-box' };
const closeBtn = { position: 'absolute', top: 20, right: 20, border: 'none', background: '#f1f5f9', width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', zIndex: 10 };
const contentPage = { padding: '50px', overflowY: 'auto', height: 'calc(100vh - 70px)', boxSizing: 'border-box' };
const adminGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' };
const adminCard = { background: 'white', padding: '15px', borderRadius: '15px', border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' };
const compactImg = { width: '70px', height: '70px', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in' };
const approveBtnMini = { padding: '8px 15px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', width: '100%' };
const sectionTitle = { fontSize: '1rem', color: '#94a3b8', fontWeight: '800', marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '1px' };
const infoBox = { position: 'absolute', bottom: 30, left: 20, background: 'white', padding: '25px', borderRadius: '25px', boxShadow: '0 20px 50px rgba(0,0,0,0.1)', width: '320px' };
const miniBtn = { flex: 1, padding: '12px', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' };
const streetBtn = { width: '100%', padding: '15px', background: '#334155', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', marginTop: '15px', cursor: 'pointer' };
const checkTitle = { fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '8px', fontWeight: 'bold' };
const checkGroup = { display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' };
const checkItem = { fontSize: '0.8rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' };
const tagStyle = { fontSize: '0.75rem', background: '#f1f5f9', color: '#334155', padding: '4px 8px', borderRadius: '6px' };