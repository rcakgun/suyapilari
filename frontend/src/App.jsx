import React, { useState, useEffect, useRef } from 'react';
import { Map, Marker, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
// firebase.js dosyasından veritabanı bağlantısını çekiyoruz
import { db } from './firebase'; 
// Firebase'in ekleme, çekme ve güncelleme özelliklerini alıyoruz
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
  
  // DATA STATES
  const [allUsers, setAllUsers] = useState([]); 
  const [allStructures, setAllStructures] = useState([]); // Onaylı yapılar
  const [pendingStructures, setPendingStructures] = useState([]); // Onay bekleyenler
  const [comments, setComments] = useState([]);
  const [activeFiltreler, setAktifFiltreler] = useState(Object.keys(YAPI_KATALOGU));
  // Sayfa açıldığında veya Admin panele girdiğinde çalışacak kod:
useEffect(() => {
  const verileriGetir = async () => {
    const querySnapshot = await getDocs(collection(db, "users"));
    const veriListesi = [];
    querySnapshot.forEach((doc) => {
      // Her bir dökümanı id'si ile beraber listeye ekliyoruz
      veriListesi.push({ id: doc.id, ...doc.data() });
    });
    setAllUsers(veriListesi); // Artık allUsers listesi buluttan geliyor!
  };
  
  verileriGetir();
}, []); // Köşeli parantez boş: Sadece sayfa ilk açıldığında çalışır

  // UI STATES
  const [activeTab, setActiveTab] = useState('map');
  const [modalMode, setModalMode] = useState(null); // 'login', 'register', 'addStructure', 'viewDetail'
  const [secilenNokta, setSecilenNokta] = useState(null);
  const [adres, setAdres] = useState("");
  const [aramaMetni, setAramaMetni] = useState("");
  const [oneriler, setOneriler] = useState([]);
  const [detayYapi, setDetayYapi] = useState(null);

  const mapRef = useRef(null);

  // --- ÜYE KAYIT (MAİL & KİMLİK FOTO) ---
  const handleRegister = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  
  // Fotoğrafı okuma işlemi (Aynı kalıyor)
  const photoFile = fd.get('kimlikFoto');
  const reader = new FileReader();

  reader.onloadend = async () => {
    try {
      // DİKKAT: Burada veriyi Firebase'deki "users" isimli kutuya (koleksiyon) atıyoruz
      await addDoc(collection(db, "users"), {
        adSoyad: fd.get('adSoyad'),
        email: fd.get('email'),
        sifre: fd.get('sifre'), // Normalde şifrelenmelidir, şimdilik böyle kalsın
        ogrenciNo: fd.get('ogrenciNo'),
        kimlikFoto: reader.result, 
        role: 'member',
        status: 'pending', // Sen onaylayana kadar bekleyecek
        kayitTarihi: new Date().toISOString()
      });

      setModalMode(null);
      alert("Harika! Başvurun Firebase bulutuna kaydedildi. Yönetici onayını bekleyebilirsin.");
    } catch (error) {
      console.error("Firebase'e yazarken hata oluştu: ", error);
      alert("Bir hata oluştu, lütfen internet bağlantını kontrol et.");
    }
  };
  if (photoFile) reader.readAsDataURL(photoFile);
};

// --- YENİ LOGIN SİSTEMİ ---
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

      if (querySnapshot.empty) {
        alert("Hatalı e-posta veya şifre!");
        return;
      }

      const userData = querySnapshot.docs[0].data();
      const userId = querySnapshot.docs[0].id;

      if (userData.status === 'pending') {
        alert("Hesabınız henüz onaylanmamış.");
      } else {
        setCurrentUser({ id: userId, ...userData });
        setModalMode(null);
      }
    } catch (error) {
      console.error("Giriş hatası:", error);
    }
  };

  // --- KULLANICI ONAYLAMA SİSTEMİ ---
  const handleApproveUser = async (userId) => {
    try {
      const userRef = doc(db, "users", userId);
      await updateDoc(userRef, { status: 'active' });
      setAllUsers(prev => prev.map(u => u.id === userId ? {...u, status: 'active'} : u));
      alert("Kullanıcı başarıyla onaylandı!");
    } catch (error) {
      alert("Hata: " + error.message);
    }
  };

  // --- YAPI EKLEME (FOTOĞRAFLI & ONAYLI) ---
  const handleAddStructure = (e) => {
    e.preventDefault();
    if (currentUser.status !== 'active') return alert("Hesabınız henüz aktive edilmedi!");

    const fd = new FormData(e.target);
    const files = Array.from(e.target.fotolar.files);
    const photoPromises = files.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(photoPromises).then(base64Photos => {
      const newS = {
        id: Date.now(),
        ad: fd.get('ad'),
        tur: fd.get('tur'),
        yil: fd.get('yil'),
        bilgi: fd.get('bilgi'),
        koordinat: secilenNokta,
        adres: adres,
        ekleyen: currentUser.email,
        fotolar: base64Photos,
        status: 'pending'
      };
      setPendingStructures([...pendingStructures, newS]);
      setModalMode(null);
      setSecilenNokta(null);
      alert("Yapı onaya gönderildi. Site sahibine mail bildirimi iletildi.");
    });
  };

  // --- ARAMA MOTORU ---
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
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#fdfdfd' }}>
      
      {/* ŞIK VE KİBAR ÜST MENÜ */}
      <nav style={navStyle}>
        <div style={{ fontWeight: '800', letterSpacing: '1px', fontSize: '1.2rem', color: '#1e40af' }}>SU MİMARİSİ <span style={{fontWeight: '300'}}>ARŞİVİ</span></div>
        
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
              <span style={{fontSize: '0.8rem', fontWeight: '600'}}>{currentUser.adSoyad}</span>
              <button onClick={() => setCurrentUser(null)} style={logoutBtn}>Çıkış</button>
            </div>
          )}
        </div>
      </nav>

      <div style={{ flex: 1, position: 'relative' }}>
        {activeTab === 'map' && (
          <>
            <Map
              {...viewState}
              ref={mapRef}
              onMove={evt => setViewState(evt.viewState)}
              mapStyle="mapbox://styles/mapbox/streets-v12"
              mapboxAccessToken={MAPBOX_TOKEN}
              projection="globe"
              onLoad={(e) => {
    const map = e.target;
    // Haritadaki tüm yazı katmanlarını bulup dillerini Türkçe ('tr') yapıyoruz
    map.getStyle().layers.forEach((layer) => {
      if (layer.layout && layer.layout['text-field']) {
        map.setLayoutProperty(layer.id, 'text-field', [
          'coalesce',
          ['get', 'name_tr'], // Önce Türkçe ismi dene
          ['get', 'name'],    // Yoksa orijinal ismi kullan
        ]);
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
                  <div onClick={(e) => { e.stopPropagation(); setDetayYapi(s); setModalMode('viewDetail'); }} style={{ fontSize: '28px', cursor: 'pointer', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>
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

            {/* FİLTRELER (SAĞ PANEL) */}
            <div style={filterPanel}>
              <div style={{fontSize: '0.7rem', fontWeight: '800', color: '#94a3b8', marginBottom: '10px'}}>KOLEKSİYON</div>
              {Object.keys(YAPI_KATALOGU).map(t => (
                <label key={t} style={filterItem}>
                  <input type="checkbox" checked={activeFiltreler.includes(t)} onChange={() => {
                    setAktifFiltreler(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
                  }} />
                  <span>{YAPI_KATALOGU[t]} {t}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {/* ADMIN PANELI */}
        {activeTab === 'admin' && (
          <div style={contentPage}>
            <h2 style={{color: '#1e40af'}}>Yönetim Merkezi</h2>
            <div style={adminGrid}>
              <section style={adminSection}>
                <h3>Üyelik Başvuruları</h3>
                {allUsers.filter(u => u.status === 'pending').map(u => (
                  <div key={u.id} style={adminCard}>
                    <p><strong>{u.adSoyad}</strong> ({u.ogrenciNo})</p>
                    <p style={{fontSize: '0.7rem'}}>{u.email}</p>
                    <img src={u.kimlikFoto} style={{width: '100%', borderRadius: '10px', margin: '10px 0'}} alt="Öğrenci Kimliği" />
                    <button onClick={() => handleApproveUser(u.id)} style={approveBtn}>Aktivasyonu Onayla</button>
                  </div>
                ))}
              </section>
              <section style={adminSection}>
                <h3>Yapı & Düzenleme Onayları</h3>
                {pendingStructures.map(s => (
                  <div key={s.id} style={adminCard}>
                    <p><strong>{s.ad}</strong> ({s.tur})</p>
                    <p style={{fontSize: '0.7rem'}}>Ekleyen: {s.ekleyen}</p>
                    <button onClick={() => {
                      setAllStructures([...allStructures, {...s, status: 'active'}]);
                      setPendingStructures(pendingStructures.filter(x => x.id !== s.id));
                    }} style={approveBtn}>Yapıyı Onayla</button>
                  </div>
                ))}
              </section>
            </div>
          </div>
        )}

        {/* PROFİLİM */}
        {activeTab === 'profile' && (
          <div style={contentPage}>
            <h2>{currentUser.adSoyad} - Eklediğim Yapılar</h2>
            <div style={adminGrid}>
              {allStructures.concat(pendingStructures).filter(s => s.ekleyen === currentUser.email).map(s => (
                <div key={s.id} style={adminCard}>
                  <h4>{s.ad}</h4>
                  <span style={{fontSize: '0.7rem', padding: '4px 8px', borderRadius: '5px', background: s.status === 'active' ? '#dcfce7' : '#fef9c3'}}>
                    {s.status === 'active' ? 'YAYINDA' : 'ONAY BEKLİYOR'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* MODAL SİSTEMİ (Login, Register, Add, Detail) */}
      {modalMode && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <button onClick={() => setModalMode(null)} style={closeBtn}>✕</button>
            
            {modalMode === 'register' && (
              <form onSubmit={handleRegister}>
                <h3>Yeni Üye Başvurusu</h3>
                <input required name="adSoyad" placeholder="Ad Soyad" style={fIn} />
                <input required name="email" type="email" placeholder="E-posta" style={fIn} />
                <input required name="sifre" type="password" placeholder="Şifre" style={fIn} />
                <input required name="ogrenciNo" placeholder="Öğrenci Numarası" style={fIn} />
                <label style={fLab}>Öğrenci Kimliği (Fotoğraf):</label>
                <input required name="kimlikFoto" type="file" accept="image/*" style={fIn} />
                <button style={actionBtn}>Kayıt Başvurusunu Tamamla</button>
              </form>
            )}

            {modalMode === 'login' && (
              <div style={{padding: '10px'}}>
                <h3>Sisteme Giriş</h3>
                <input id="loginEmail" placeholder="E-posta" style={fIn} />
                <input id="loginPass" type="password" placeholder="Şifre" style={fIn} />
               <button onClick={handleLogin} style={actionBtn}>Giriş Yap</button>
                <p style={{fontSize: '0.7rem', marginTop: '10px', color: '#666'}}>* Test için önce kayıt olun, sonra Yönetici ile kendinizi onaylayın.</p>
              </div>
            )}

            {modalMode === 'addStructure' && (
              <form onSubmit={handleAddStructure}>
                <h3>Yeni Yapı Detayları</h3>
                <input required name="ad" placeholder="Yapı Adı" style={fIn} />
                <select name="tur" style={fIn}>
                  {Object.keys(YAPI_KATALOGU).map(t => <option key={t}>{t}</option>)}
                </select>
                <input required name="yil" placeholder="İnşa Yılı" style={fIn} />
                <textarea required name="bilgi" placeholder="Yapı Hakkında Mimari/Tarihi Bilgi" style={{...fIn, height: '100px'}} />
                <label style={fLab}>Fotoğraflar (Birden fazla seçilebilir, her biri max 2MB):</label>
                <input required name="fotos" type="file" multiple accept="image/*" style={fIn} />
                <button style={actionBtn}>Onaya Gönder</button>
              </form>
            )}

            {modalMode === 'viewDetail' && detayYapi && (
              <div>
                <h2 style={{margin: 0, color: '#1e40af'}}>{detayYapi.ad}</h2>
                <p style={{fontSize: '0.9rem', color: '#64748b'}}>{detayYapi.tur} • {detayYapi.yil}</p>
                <p style={{lineHeight: '1.6', fontSize: '0.95rem'}}>{detayYapi.bilgi}</p>
                <div style={{display: 'flex', gap: '10px', overflowX: 'auto', padding: '10px 0'}}>
                  {detayYapi.fotolar?.map((img, i) => <img key={i} src={img} style={{height: '140px', borderRadius: '10px'}} alt="Yapı" />)}
                </div>
                <button onClick={() => window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${detayYapi.koordinat.lat},${detayYapi.koordinat.lng}`, '_blank')} style={streetBtn}>📷 Street View Bağlantısı</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEÇİLEN KONUM AKSİYON KUTUSU */}
      {secilenNokta && activeTab === 'map' && !modalMode && (
        <div style={infoBox}>
          <p style={{fontSize: '0.75rem', color: '#64748b', marginBottom: '12px'}}>{adres}</p>
          <div style={{display: 'flex', gap: '10px'}}>
            <button onClick={() => window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${secilenNokta.lat},${secilenNokta.lng}`, '_blank')} style={{...miniBtn, background: '#334155'}}>📷 Sokak</button>
            <button 
              disabled={!currentUser || currentUser.status === 'pending'}
              onClick={() => setModalMode('addStructure')} 
              style={{...miniBtn, background: (!currentUser || currentUser.status === 'pending') ? '#ccc' : '#10b981'}}
            >
              {!currentUser ? "Giriş Gerekli" : "➕ Yapı Ekle"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// STYLES
const navStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 30px', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #e2e8f0', zIndex: 100 };
const menuItem = (active) => ({ background: 'transparent', border: 'none', color: active ? '#1e40af' : '#64748b', fontWeight: active ? 'bold' : '500', cursor: 'pointer', fontSize: '0.9rem' });
const loginBtn = { padding: '8px 20px', borderRadius: '10px', border: '1px solid #1e40af', color: '#1e40af', background: 'white', fontWeight: 'bold', cursor: 'pointer' };
const registerBtn = { padding: '8px 20px', borderRadius: '10px', border: 'none', background: '#1e40af', color: 'white', fontWeight: 'bold', cursor: 'pointer' };
const logoutBtn = { background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 15px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' };
const searchInput = { width: '100%', padding: '15px', borderRadius: '15px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', outline: 'none' };
const searchList = { background: 'white', marginTop: '5px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', overflow: 'hidden' };
const searchItem = { padding: '12px', fontSize: '0.8rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' };
const filterPanel = { position: 'absolute', top: 20, right: 20, background: 'white', padding: '20px', borderRadius: '20px', boxShadow: '0 4px 30px rgba(0,0,0,0.05)', width: '180px' };
const filterItem = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#475569', marginBottom: '8px', cursor: 'pointer' };
const modalOverlay = { position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 };
const modalBox = { background: 'white', padding: '40px', borderRadius: '30px', width: '450px', position: 'relative', boxShadow: '0 25px 50px rgba(0,0,0,0.15)' };
const fIn = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '10px', outline: 'none' };
const fLab = { display: 'block', fontSize: '0.65rem', fontWeight: 'bold', color: '#94a3b8', marginBottom: '5px', textTransform: 'uppercase' };
const actionBtn = { width: '100%', padding: '15px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' };
const closeBtn = { position: 'absolute', top: 20, right: 20, border: 'none', background: '#f1f5f9', width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer' };
const contentPage = { padding: '50px', maxWidth: '1100px', margin: '0 auto', overflowY: 'auto', height: '100%' };
const adminGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' };
const adminSection = { background: '#f8fafc', padding: '20px', borderRadius: '20px' };
const adminCard = { background: 'white', padding: '15px', borderRadius: '15px', border: '1px solid #e2e8f0', marginBottom: '15px' };
const approveBtn = { width: '100%', padding: '10px', background: '#10b981', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer' };
const infoBox = { position: 'absolute', bottom: 30, left: 20, background: 'white', padding: '20px', borderRadius: '25px', boxShadow: '0 20px 50px rgba(0,0,0,0.1)', width: '320px' };
const miniBtn = { flex: 1, padding: '12px', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' };
const streetBtn = { width: '100%', padding: '12px', background: '#334155', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', marginTop: '15px', cursor: 'pointer' };