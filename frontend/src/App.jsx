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

export default function App() {
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

  useEffect(() => {
    const verileriGetir = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "users"));
        const veriListesi = [];
        querySnapshot.forEach((doc) => {
          veriListesi.push({ id: doc.id, ...doc.data() });
        });
        setAllUsers(veriListesi);
      } catch (e) { console.error("Veri hatası:", e); }
    };
    verileriGetir();
  }, [activeTab]); // Tab değiştikçe listeyi tazele

  // --- KAYIT OL (Mükerrer Kontrolü Eklendi) ---
  const handleRegister = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email');

    try {
      // Önce bu mail var mı kontrol et
      const q = query(collection(db, "users"), where("email", "==", email));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        return alert("Bu e-posta adresi ile zaten bir başvuru yapılmış!");
      }

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
        alert("Başvurunuz alındı. Yönetici onayı bekliyor.");
      };
      if (photoFile) reader.readAsDataURL(photoFile);
    } catch (error) { alert("Hata: " + error.message); }
  };

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

  const handleApproveUser = async (userId) => {
    try {
      const userRef = doc(db, "users", userId);
      await updateDoc(userRef, { status: 'active' });
      setAllUsers(prev => prev.map(u => u.id === userId ? {...u, status: 'active'} : u));
      alert("Üye başarıyla aktif edildi.");
    } catch (error) { alert(error.message); }
  };

  const handleAddStructure = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const files = Array.from(e.target.fotos.files); 
    const photoPromises = files.map(file => new Promise(res => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.readAsDataURL(file);
    }));

    Promise.all(photoPromises).then(base64Photos => {
      const newS = {
        id: Date.now(),
        ad: fd.get('ad'),
        tur: fd.get('tur'),
        yil: fd.get('yil'),
        bilgi: fd.get('bilgi'),
        koordinat: secilenNokta,
        adres,
        ekleyen: currentUser.email,
        fotolar: base64Photos,
        status: 'pending'
      };
      setPendingStructures([...pendingStructures, newS]);
      setModalMode(null);
      alert("Yapı onaya gönderildi.");
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#fdfdfd', fontFamily: 'sans-serif' }}>
      
      <nav style={navStyle}>
        <div style={{ fontWeight: '800', fontSize: '1.2rem', color: '#1e40af' }}>SU MİMARİSİ ARŞİVİ</div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <button onClick={() => setActiveTab('map')} style={menuItem(activeTab === 'map')}>Harita</button>
          {currentUser && <button onClick={() => setActiveTab('profile')} style={menuItem(activeTab === 'profile')}>Profilim</button>}
          {currentUser?.role === 'admin' && <button onClick={() => setActiveTab('admin')} style={{...menuItem(activeTab === 'admin'), color: '#dc2626'}}>Yönetim</button>}
          {!currentUser ? (
            <div style={{display: 'flex', gap: '10px'}}>
              <button onClick={() => setModalMode('login')} style={loginBtn}>Giriş</button>
              <button onClick={() => setModalMode('register')} style={registerBtn}>Üye Ol</button>
            </div>
          ) : (
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <span style={{fontSize: '0.8rem', fontWeight: 'bold'}}>{currentUser.adSoyad}</span>
              <button onClick={() => setCurrentUser(null)} style={logoutBtn}>Çıkış</button>
            </div>
          )}
        </div>
      </nav>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {activeTab === 'map' && (
          <>
            <Map
              {...viewState}
              ref={mapRef}
              onMove={evt => setViewState(evt.viewState)}
              mapStyle="mapbox://styles/mapbox/streets-v12"
              mapboxAccessToken={MAPBOX_TOKEN}
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
          </>
        )}

        {activeTab === 'admin' && (
          <div style={contentPage}>
            <h2 style={{color: '#1e40af', marginBottom: '30px'}}>Sistem Yönetimi</h2>
            
            {/* BEKLEYEN BAŞVURULAR (KOMPAKT) */}
            <h3 style={sectionTitle}>Onay Bekleyen Başvurular</h3>
            <div style={adminGrid}>
              {allUsers.filter(u => u.status === 'pending').map(u => (
                <div key={u.id} style={adminCard}>
                  <div style={{display: 'flex', gap: '15px'}}>
                    <img 
                      src={u.kimlikFoto} 
                      onClick={() => setZoomPhoto(u.kimlikFoto)}
                      style={compactImg} 
                      alt="Kimlik" 
                    />
                    <div style={{flex: 1}}>
                      <p style={{margin: '0 0 5px 0', fontWeight: 'bold'}}>{u.adSoyad}</p>
                      <p style={{fontSize: '0.7rem', color: '#666', margin: '0 0 10px 0'}}>{u.email} <br/> No: {u.ogrenciNo}</p>
                      <button onClick={() => handleApproveUser(u.id)} style={approveBtnMini}>Onayla</button>
                    </div>
                  </div>
                </div>
              ))}
              {allUsers.filter(u => u.status === 'pending').length === 0 && <p>Yeni başvuru yok.</p>}
            </div>

            <hr style={{margin: '40px 0', border: 'none', borderTop: '1px solid #eee'}} />

            {/* KABUL EDİLEN ÜYELER LİSTESİ */}
            <h3 style={sectionTitle}>Aktif Üyeler</h3>
            <div style={adminGrid}>
              {allUsers.filter(u => u.status === 'active' && u.role !== 'admin').map(u => (
                <div key={u.id} style={{...adminCard, opacity: 0.8}}>
                   <p style={{margin: '0 0 5px 0', fontWeight: 'bold'}}>{u.adSoyad}</p>
                   <p style={{fontSize: '0.7rem', color: '#666'}}>{u.email} - No: {u.ogrenciNo}</p>
                   <span style={{fontSize: '0.6rem', color: '#10b981', fontWeight: 'bold'}}>● AKTİF</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modalMode && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <button onClick={() => setModalMode(null)} style={closeBtn}>✕</button>
            {modalMode === 'login' && (
              <div style={{width: '100%'}}>
                <h3>Giriş Yap</h3>
                <input id="loginEmail" placeholder="E-posta" style={fIn} />
                <input id="loginPass" type="password" placeholder="Şifre" style={fIn} />
                <button onClick={handleLogin} style={actionBtn}>Giriş</button>
              </div>
            )}
            {modalMode === 'register' && (
              <form onSubmit={handleRegister} style={{width: '100%'}}>
                <h3>Üye Ol</h3>
                <input required name="adSoyad" placeholder="Ad Soyad" style={fIn} />
                <input required name="email" type="email" placeholder="E-posta" style={fIn} />
                <input required name="sifre" type="password" placeholder="Şifre" style={fIn} />
                <input required name="ogrenciNo" placeholder="Öğrenci No" style={fIn} />
                <input required name="kimlikFoto" type="file" style={fIn} />
                <button style={actionBtn}>Kaydı Tamamla</button>
              </form>
            )}
            {modalMode === 'viewDetail' && detayYapi && (
              <div style={{width: '100%'}}>
                <h2 style={{margin: 0, color: '#1e40af'}}>{detayYapi.ad}</h2>
                <p style={{fontSize: '0.8rem', color: '#666'}}>{detayYapi.tur}</p>
                <p style={{fontSize: '0.9rem', lineHeight: '1.5'}}>{detayYapi.bilgi}</p>
                <button 
                  onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${detayYapi.koordinat.lat},${detayYapi.koordinat.lng}`, '_blank')} 
                  style={streetBtn}
                >
                  📷 Street View'da Aç
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {zoomPhoto && (
        <div onClick={() => setZoomPhoto(null)} style={{...modalOverlay, background: 'rgba(0,0,0,0.9)', zIndex: 3000}}>
          <img src={zoomPhoto} style={{maxHeight: '90vh', maxWidth: '90vw', borderRadius: '10px'}} alt="Zoom" />
        </div>
      )}

      {secilenNokta && activeTab === 'map' && (
        <div style={infoBox}>
          <p style={{fontSize: '0.7rem', color: '#666', marginBottom: '10px'}}>{adres}</p>
          <button onClick={() => setModalMode('addStructure')} style={miniBtn}>➕ Yapı Ekle</button>
        </div>
      )}
    </div>
  );
}

// --- STİLLER ---
const navStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 30px', background: 'white', borderBottom: '1px solid #e2e8f0', zIndex: 100 };
const menuItem = (active) => ({ background: 'transparent', border: 'none', color: active ? '#1e40af' : '#64748b', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' });
const loginBtn = { padding: '8px 20px', borderRadius: '10px', border: '1px solid #1e40af', color: '#1e40af', background: 'white', cursor: 'pointer', fontWeight: 'bold' };
const registerBtn = { padding: '8px 20px', borderRadius: '10px', border: 'none', background: '#1e40af', color: 'white', cursor: 'pointer', fontWeight: 'bold' };
const logoutBtn = { background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 15px', borderRadius: '10px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold' };
const contentPage = { padding: '40px', overflowY: 'auto', height: 'calc(100vh - 70px)', boxSizing: 'border-box' };
const adminGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' };
const adminCard = { background: 'white', padding: '15px', borderRadius: '15px', border: '1px solid #eee', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' };
const compactImg = { width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in' };
const approveBtnMini = { padding: '8px 15px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem' };
const sectionTitle = { fontSize: '1.1rem', color: '#64748b', marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '1px' };
const modalOverlay = { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' };
const modalBox = { background: 'white', padding: '30px', borderRadius: '25px', width: '400px', position: 'relative', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' };
const fIn = { width: '100%', padding: '12px', marginBottom: '10px', borderRadius: '10px', border: '1px solid #ddd', boxSizing: 'border-box' };
const actionBtn = { width: '100%', padding: '15px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' };
const closeBtn = { position: 'absolute', top: 15, right: 15, border: 'none', background: '#eee', borderRadius: '50%', cursor: 'pointer', width: '30px', height: '30px' };
const infoBox = { position: 'absolute', bottom: 20, left: 20, background: 'white', padding: '15px', borderRadius: '15px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', width: '280px' };
const miniBtn = { width: '100%', padding: '10px', background: '#10b981', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' };
const streetBtn = { width: '100%', padding: '12px', background: '#334155', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', marginTop: '15px', cursor: 'pointer' };