import React, { useState, useEffect, useRef } from 'react';
import { Map, Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { db } from './firebase'; 
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, where, setDoc, getDoc } from "firebase/firestore";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const YAPI_KATALOGU = {
  'Çeşme': '⛲', 'Sebil': '🏺', 'Sarnıç': '🏛️', 'Hamam': '🧼', 'Su Kemeri': '🌉',
  'Maksem': '🛖', 'Ayazma': '💧', 'Şadırvan': '⛲', 'Bent': '🌊', 'Su Terazisi': '🗼'
};

const BOZULMA_DURUMLARI = ['İyi', 'Orta', 'Kötü'];
const MALZEME_TURLERI = ['Taş', 'Tuğla', 'Ahşap', 'Mermer', 'Metal', 'Beton', 'Harç'];
const BOZULMA_TURLERI = ['Çatlak', 'Kırık', 'Eksilme', 'Bitkilenme', 'Renk Değişimi', 'Kirlenme', 'Aşınma'];
const FOTO_TURLERI = ['Genel', 'Detay', 'Rölöve'];
const FOTO_YILLARI = Array.from({length: new Date().getFullYear() - 1849}, (_, i) => new Date().getFullYear() - i); // 1850'den günümüze
const FOTO_AYLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const FOTO_GUNLERI = Array.from({length: 31}, (_, i) => i + 1);

// --- GÜVENLİK VE PERFORMANS FONKSİYONLARI ---
const compressImage = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
        let width = img.width; let height = img.height;

        if (width > height && width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } 
        else if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6)); // %60 kalite ile sıkıştırıp 1MB çökmesini engeller
      };
    };
  });
};

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
  const [listArama, setListArama] = useState("");
  const [oneriler, setOneriler] = useState([]);
  const [detayYapi, setDetayYapi] = useState(null);
  const [zoomPhoto, setZoomPhoto] = useState(null); 
  const [wikiBilgi, setWikiBilgi] = useState(null);
  const [isSesliOkunuyor, setIsSesliOkunuyor] = useState(false);
  const [secilenDosyalar, setSecilenDosyalar] = useState([]);

  // Her fotoğrafın kendi bilgisini güncelleyen fonksiyon
  const updateDosyaMeta = (index, field, value) => {
    const yeni = [...secilenDosyalar];
    yeni[index][field] = value;
    setSecilenDosyalar(yeni);
  };

  const [isFiltreAcik, setIsFiltreAcik] = useState(true);
  const mapRef = useRef(null);
  
// --- BİLDİRİM MOTORU (MADDE 1 VE 2 İÇİN ALTYAPI) ---
  const sendNotification = async (targetEmail, text) => {
    if (!targetEmail) return;
    try {
      const q = query(collection(db, "users"), where("email", "==", targetEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const userDoc = snap.docs[0];
        const notifs = userDoc.data().notifications || [];
        const yeniBildirim = { id: Date.now(), text, read: false, date: new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) };
        notifs.unshift(yeniBildirim);
        await updateDoc(doc(db, "users", userDoc.id), { notifications: notifs });
      }
    } catch (err) { console.error("Bildirim hatası:", err); }
  };

  const okunmamisBildirimSayisi = currentUser?.notifications?.filter(n => !n.read).length || 0;

  // --- FIREBASE: VERI CEKME ---
  useEffect(() => {
    const verileriGetir = async () => {
      try {
        // Kullanıcının kendi güncel profilini (ve bildirimlerini) sürekli taze tut
        if (currentUser) {
          const cUserDoc = await getDoc(doc(db, "users", currentUser.id));
          if (cUserDoc.exists()) setCurrentUser({ id: currentUser.id, ...cUserDoc.data() });
        }
       // Kullanıcıları Çek (SADECE ADMİN İSE)
        if (currentUser && currentUser.role === 'admin') {
          const userSnapshot = await getDocs(collection(db, "users"));
          const userListesi = [];
          userSnapshot.forEach((doc) => {
            userListesi.push({ id: doc.id, ...doc.data() });
          });
          setAllUsers(userListesi);
        } else {
          setAllUsers([]); // Admin değilse başkalarının bilgisini indirme
        }

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
  }, [currentUser]); // activeTab silindi. Artık sekme değiştikçe veritabanı yorulmayacak.

  // --- KAYIT OL (Mükerrer Kontrolü Dahil) ---
  // --- KAYIT OL (Firebase Auth Entegreli) ---
  const handleRegister = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email');
    const sifre = fd.get('sifre');
    const auth = getAuth();

    try {
      // 1. Firebase Auth'a Kaydet
      const userCredential = await createUserWithEmailAndPassword(auth, email, sifre);
      const uid = userCredential.user.uid;

      // 2. Kullanıcı Profilini Firestore'a Auth UID'si ile Kaydet
      await setDoc(doc(db, "users", uid), {
        adSoyad: fd.get('adSoyad'),
        email: email,
        ogrenciNo: fd.get('ogrenciNo'),
        role: 'member',
        status: 'pending',
        kayitTarihi: new Date().toISOString()
      });
      
      await signOut(auth); // Onaylanana kadar oturumu kapalı tut
      setModalMode(null);
      alert("Başvurunuz kaydedildi. Yönetici onayı bekleyin.");
    } catch (error) {
      if(error.code === 'auth/weak-password') alert("Şifre en az 6 karakter olmalıdır.");
      else if(error.code === 'auth/email-already-in-use') alert("Bu e-posta adresi ile zaten bir başvuru mevcut!");
      else alert("Hata: " + error.message); 
    }
  };

  // --- GİRİŞ YAP ---
 // --- GİRİŞ YAP (Firebase Auth Entegreli) ---
  const handleLogin = async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const sifre = document.getElementById('loginPass').value;
    const auth = getAuth();

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, sifre);
      const uid = userCredential.user.uid;
      
      const userDoc = await getDoc(doc(db, "users", uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.status === 'pending') {
          await signOut(auth);
          return alert("Hesabınız henüz onaylanmadı.");
        }
        if (userData.status === 'banned' || userData.status === 'deleted') {
          await signOut(auth);
          return alert("Hesabınız yönetici tarafından engellenmiş veya silinmiştir.");
        }
        setCurrentUser({ id: uid, ...userData });
        setModalMode(null);
      }
    } catch (error) { 
      alert("Hatalı e-posta veya şifre girdiniz!"); 
      console.error(error); 
    }
  };

  // --- ŞİFREMİ UNUTTUM ---
  const handleResetPassword = async () => {
    const email = document.getElementById('loginEmail').value;
    if (!email) return alert("Lütfen önce e-posta adresinizi kutucuğa yazın, ardından bu butona tıklayın.");
    
    const auth = getAuth();
    try {
      await sendPasswordResetEmail(auth, email);
      alert("Şifre sıfırlama bağlantısı e-posta adresinize gönderildi!");
    } catch (error) {
      alert("Hata: Kayıtlı bir e-posta adresi bulunamadı.");
    }
  };

  // --- ÜYEYİ ONAYLA ---
  const handleApproveUser = async (userId) => {
    try {
      const userRef = doc(db, "users", userId);
      const u = allUsers.find(x => x.id === userId);
      const notifs = u.notifications || [];
      notifs.unshift({ id: Date.now(), text: "Tebrikler! Üyeliğiniz onaylandı, artık haritaya yapı ekleyebilirsiniz.", read: false, date: new Date().toLocaleDateString('tr-TR') });
      
      await updateDoc(userRef, { status: 'active', notifications: notifs });
      setAllUsers(prev => prev.map(user => user.id === userId ? {...user, status: 'active', notifications: notifs} : user));
      alert("Üye aktif edildi ve bildirim gönderildi!");
    } catch (error) { alert(error.message); }
  };

  // --- ÜYEYİ SİL (ADMİN) ---
  // --- ÜYEYİ ENGELLE (ADMİN) ---
  const handleDeleteUser = async (userId) => {
    if (!window.confirm("Bu üyeyi silmek/engellemek istediğinize emin misiniz? (Eklediği yapılar haritada kalmaya devam edecek)")) return;
    try {
      await updateDoc(doc(db, "users", userId), { status: 'banned' });
      setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, status: 'banned' } : u));
      alert("Üye başarıyla engellendi!");
    } catch (error) { alert("Hata: " + error.message); }
  };

  // --- YAPI EKLEME (FIREBASE VE YENİ ALANLAR) ---
  const handleAddStructure = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    // ÇAKIŞMA KONTROLÜ (MADDE 8)
    const girilenAd = fd.get('ad').trim().toLowerCase();
    const isimCakismasi = allStructures.concat(pendingStructures).some(
      s => s.ad.toLowerCase() === girilenAd
    );
    if (isimCakismasi) return alert("Bu isimde bir yapı sistemde zaten mevcut veya onay bekliyor! Lütfen farklı bir isim girin.");
    const files = Array.from(e.target.fotos.files); 
    const photoPromises = secilenDosyalar.map(dosya => 
      compressImage(dosya.file).then(b64 => ({
        data: b64,
        meta: { yil: dosya.yil, ay: dosya.ay, gun: dosya.gun, tur: dosya.tur, kaynak: dosya.kaynak }
      }))
    );

    Promise.all(photoPromises).then(async (base64PhotosWithMeta) => {
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
        fotolar: base64PhotosWithMeta,
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
        setSecilenDosyalar([]); // Başarılı olunca listeyi temizle
        alert("Yapı bilgileri başarıyla güncellendi!");
      } catch (err) {
        console.error("Güncelleme hatası: ", err);
      }
    };

    if (secilenDosyalar.length > 0) {
      const photoPromises = secilenDosyalar.map(dosya => 
        compressImage(dosya.file).then(b64 => ({
          data: b64,
          meta: { yil: dosya.yil, ay: dosya.ay, gun: dosya.gun, tur: dosya.tur, kaynak: dosya.kaynak }
        }))
      );
      
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

  // --- YAPIYI SİL (ADMİN) ---
  const handleDeleteStructure = async (structureId) => {
    if (!window.confirm("Bu yapıyı kalıcı olarak silmek istediğinize emin misiniz?")) return;
    try {
      await deleteDoc(doc(db, "structures", structureId));
      setAllStructures(prev => prev.filter(s => s.id !== structureId));
      setPendingStructures(prev => prev.filter(s => s.id !== structureId));
      setModalMode(null);
      alert("Yapı başarıyla silindi!");
    } catch (error) { alert("Hata: " + error.message); }
  };

// --- BEĞENİ VE YORUM SİSTEMİ (MADDE 9 ve 10) ---
  const handleLikeDislike = async (type) => {
    if (!currentUser) return alert("Beğeni bırakmak için giriş yapmalısınız.");
    
    const userId = currentUser.email;
    let likes = detayYapi.likes || [];
    let dislikes = detayYapi.dislikes || [];

    // Tıklama mantığı: Zaten beğendiyse geri al, beğenmediyse beğen. (Aynı anda hem like hem dislike olamaz)
    if (type === 'like') {
      if (likes.includes(userId)) likes = likes.filter(id => id !== userId);
      else { likes.push(userId); dislikes = dislikes.filter(id => id !== userId); }
    } else {
      if (dislikes.includes(userId)) dislikes = dislikes.filter(id => id !== userId);
      else { dislikes.push(userId); likes = likes.filter(id => id !== userId); }
    }

    const updatedStructure = { ...detayYapi, likes, dislikes };
    // Yeni bildirim kodu
    if (type === 'like' && detayYapi.ekleyen && detayYapi.ekleyen !== currentUser.email && !detayYapi.likes?.includes(userId)) {
      await sendNotification(detayYapi.ekleyen, `"${detayYapi.ad}" isimli yapınız ${currentUser.adSoyad} tarafından beğenildi! 👍`);
    }
    try {
      await updateDoc(doc(db, "structures", detayYapi.id), { likes, dislikes });
      setDetayYapi(updatedStructure);
      setAllStructures(prev => prev.map(s => s.id === detayYapi.id ? updatedStructure : s));
    } catch (error) { console.error("Beğeni hatası:", error); }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("Yorum yapmak için giriş yapmalısınız.");
    
    const text = e.target.comment.value.trim();
    if (!text) return;

    const newComment = {
      user: currentUser.adSoyad,
      text,
      date: new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
    };

    const comments = [...(detayYapi.comments || []), newComment];
    const updatedStructure = { ...detayYapi, comments };

    try {
      await updateDoc(doc(db, "structures", detayYapi.id), { comments });
      setDetayYapi(updatedStructure);
      setAllStructures(prev => prev.map(s => s.id === detayYapi.id ? updatedStructure : s));
      e.target.reset();
      if (detayYapi.ekleyen && detayYapi.ekleyen !== currentUser.email) {
        await sendNotification(detayYapi.ekleyen, `"${detayYapi.ad}" yapınıza ${currentUser.adSoyad} yeni bir yorum bıraktı.`);
      }
    } catch (error) { console.error("Yorum hatası:", error); }
  };

  // --- DIŞ BAĞLANTILAR (MADDE 5 VE 6 - WIKIPEDIA VE SESLİ OKUMA) ---
  useEffect(() => {
    if (modalMode === 'viewDetail' && detayYapi) {
      const fetchWiki = async () => {
        try {
          setWikiBilgi("Ansiklopedik bilgi aranıyor...");
          // Wikipedia'dan sadece giriş kısmını (en fazla 4 cümle) çeken sorgu
          // Wikipedia'dan yapının tüm detaylı giriş/tarihçe özetini çeken sorgu
          // Wikipedia arama motoru (Büyük/küçük harf sorununu ve ufak isim farklılıklarını tolere eder)
          const res = await fetch(`https://tr.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&generator=search&gsrsearch=${encodeURIComponent(detayYapi.ad)}&gsrlimit=1&explaintext=1&format=json&origin=*`);
          const data = await res.json();
          
          if (!data.query || !data.query.pages) {
            setWikiBilgi("Wikipedia'da bu yapıya ait özet bulunamadı.");
          } else {
            const pages = data.query.pages;
            const pageId = Object.keys(pages)[0];
            setWikiBilgi(pages[pageId].extract);
          }
        } catch (e) {
          setWikiBilgi("Bilgi çekilirken bir hata oluştu.");
        }
      };
      fetchWiki();
    } else {
      setWikiBilgi(null);
      window.speechSynthesis.cancel();
      setIsSesliOkunuyor(false);
    }
  }, [modalMode, detayYapi]);

  const handleSesliOku = (metin) => {
    if (isSesliOkunuyor) {
      window.speechSynthesis.cancel();
      setIsSesliOkunuyor(false);
    } else {
      window.speechSynthesis.cancel(); // Çakışmaları önlemek için önce durdur
      const u = new SpeechSynthesisUtterance(metin);
      u.lang = 'tr-TR';
      u.onend = () => setIsSesliOkunuyor(false);
      window.speechSynthesis.speak(u);
      setIsSesliOkunuyor(true);
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
        <div style={{ fontWeight: '800', fontSize: '1.2rem', color: '#1e40af' }}>SU YAPILARI<span style={{fontWeight: '300'}}>HARİTASI</span></div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <button onClick={() => setActiveTab('map')} style={menuItem(activeTab === 'map')}>Harita</button>
          <button onClick={() => setActiveTab('list')} style={menuItem(activeTab === 'list')}>Yapı Listesi</button>
          {currentUser && (
            <button onClick={() => setActiveTab('profile')} style={{...menuItem(activeTab === 'profile'), position: 'relative'}}>
              Profilim
              {okunmamisBildirimSayisi > 0 && (
                <span style={{position: 'absolute', top: '-8px', right: '-12px', background: '#ef4444', color: 'white', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold'}}>{okunmamisBildirimSayisi}</span>
              )}
            </button>
          )}
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
              <button onClick={async () => { await signOut(getAuth()); setCurrentUser(null); setActiveTab('map'); }} style={logoutBtn}>Çıkış</button>
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
            <div style={{ position: 'absolute', top: 15, left: 15, width: 'calc(100% - 30px)', maxWidth: '320px', zIndex: 10 }}>
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

            {/* FİLTRELER (Açılır Kapanır - Madde 4) */}
            <div style={filterPanel}>
              <div 
                onClick={() => setIsFiltreAcik(!isFiltreAcik)}
                style={{fontSize: '0.7rem', fontWeight: '800', color: '#94a3b8', marginBottom: isFiltreAcik ? '10px' : '0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}
              >
                KOLEKSİYON <span style={{fontSize: '0.6rem'}}>{isFiltreAcik ? '▼' : '▲'}</span>
              </div>
              {isFiltreAcik && Object.keys(YAPI_KATALOGU).map(t => (
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
                    <div style={{flex: 1}}>
                      <p style={{margin: '0 0 4px 0', fontWeight: 'bold', fontSize: '0.85rem'}}>{u.adSoyad}</p>
                      <p style={{fontSize: '0.7rem', color: '#666', margin: '0 0 8px 0'}}>{u.email} <br/> No: {u.ogrenciNo}</p>
                      <div style={{display: 'flex', gap: '5px'}}>
                      <button onClick={() => handleApproveUser(u.id)} style={approveBtnMini}>Onayla</button>
                      <button onClick={() => handleDeleteUser(u.id)} style={{...approveBtnMini, background: '#ef4444'}}>Sil</button>
                      </div>
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
                        <img key={i} src={typeof img === 'string' ? img : img.data} onClick={() => setZoomPhoto(typeof img === 'string' ? img : img.data)} style={{height: '60px', borderRadius: '5px', cursor: 'zoom-in'}} alt="Yapı" />
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
                        await sendNotification(s.ekleyen, `Tebrikler! "${s.ad}" isimli yapı başvurunuz onaylandı ve haritaya eklendi.`);
                        alert("Yapı haritaya eklendi!");
                      }} 
                      style={{...approveBtnMini, flex: 1}}
                    >
                      Onayla
                    </button>
                    <button onClick={() => handleDeleteStructure(s.id)} style={{...approveBtnMini, flex: 1, background: '#ef4444'}}>
                      Sil
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
                   <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px'}}>
                    <span style={{fontSize: '0.6rem', color: '#10b981', fontWeight: 'bold'}}>● AKTİF ÜYE</span>
                    <button onClick={() => handleDeleteUser(u.id)} style={{...approveBtnMini, background: '#ef4444', width: 'auto', padding: '4px 10px'}}>Sil</button>
                    </div>  
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'profile' && currentUser && (
          <div style={contentPage}>
            
            <div style={{display: 'flex', flexWrap: 'wrap', gap: '30px', alignItems: 'flex-start'}}>
              {/* BİLDİRİMLER ALANI */}
              <div style={{flex: 1, minWidth: '300px', background: 'white', padding: '20px', borderRadius: '15px', border: '1px solid #e2e8f0', boxShadow: '0 4px 15px rgba(0,0,0,0.03)'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                  <h3 style={{margin: 0, color: '#1e40af'}}>🔔 Bildirimlerim</h3>
                  {okunmamisBildirimSayisi > 0 && (
                    <button 
                      onClick={async () => {
                        const updatedNotifs = currentUser.notifications.map(n => ({...n, read: true}));
                        await updateDoc(doc(db, "users", currentUser.id), { notifications: updatedNotifs });
                        setCurrentUser({...currentUser, notifications: updatedNotifs});
                      }} 
                      style={{background: 'transparent', border: 'none', color: '#10b981', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold'}}
                    >
                      Hepsini Okundu İşaretle ✓
                    </button>
                  )}
                </div>
                
                <div style={{display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '400px', overflowY: 'auto'}}>
                  {!currentUser.notifications || currentUser.notifications.length === 0 ? (
                    <p style={{color: '#94a3b8', fontSize: '0.85rem'}}>Henüz hiç bildiriminiz yok.</p>
                  ) : (
                    currentUser.notifications.map(n => (
                      <div key={n.id} style={{padding: '12px', background: n.read ? '#f8fafc' : '#eff6ff', borderRadius: '10px', borderLeft: n.read ? 'none' : '4px solid #3b82f6'}}>
                        <p style={{margin: '0 0 5px 0', fontSize: '0.85rem', color: '#334155'}}>{n.text}</p>
                        <span style={{fontSize: '0.65rem', color: '#94a3b8'}}>{n.date}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* EKLEDİĞİM YAPILAR ALANI */}
              <div style={{flex: 2, minWidth: '300px'}}>
                <h2 style={{marginTop: 0, color: '#1e40af'}}>Eklediğim Yapılar</h2>
                <div style={adminGrid}>
                  {allStructures.concat(pendingStructures).filter(s => s.ekleyen === currentUser.email).map(s => (
                    <div key={s.id} style={adminCard}>
                      <h4 style={{margin: '0 0 10px 0'}}>{s.ad}</h4>
                      <span style={{fontSize: '0.7rem', padding: '5px 10px', borderRadius: '8px', background: s.status === 'active' ? '#dcfce7' : '#fef9c3', fontWeight: 'bold'}}>
                        {s.status === 'active' ? '✅ YAYINDA' : '⏳ ONAY BEKLİYOR'}
                      </span>
                    </div>
                  ))}
                  {allStructures.concat(pendingStructures).filter(s => s.ekleyen === currentUser.email).length === 0 && (
                    <p style={{color: '#94a3b8', fontSize: '0.85rem'}}>Henüz sisteme bir yapı eklemediniz.</p>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}
{activeTab === 'list' && (
          <div style={contentPage}>
            <h2 style={{color: '#1e40af', marginBottom: '20px'}}>Tüm Yapılar Listesi</h2>
            
            {/* Arama ve Kategori Filtreleme */}
            <div style={{display: 'flex', gap: '15px', marginBottom: '30px', flexWrap: 'wrap', alignItems: 'center'}}>
              <input 
                type="text" 
                placeholder="Yapı adı ile ara..." 
                value={listArama} 
                onChange={e => setListArama(e.target.value)} 
                style={{...fIn, width: '300px', marginBottom: 0}} 
              />
              <div style={{display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '5px'}}>
                {Object.keys(YAPI_KATALOGU).map(t => (
                  <label key={t} style={{display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', cursor: 'pointer', background: activeFiltreler.includes(t) ? '#1e40af' : '#f1f5f9', color: activeFiltreler.includes(t) ? 'white' : '#334155', padding: '8px 12px', borderRadius: '20px', whiteSpace: 'nowrap'}}>
                    <input type="checkbox" checked={activeFiltreler.includes(t)} onChange={() => setAktifFiltreler(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])} style={{display: 'none'}} />
                    {YAPI_KATALOGU[t]} {t}
                  </label>
                ))}
              </div>
            </div>

            {/* Yapı Kartları */}
            <div style={adminGrid}>
              {allStructures
                .filter(s => activeFiltreler.includes(s.tur))
                .filter(s => s.ad.toLowerCase().includes(listArama.toLowerCase()))
                .map(s => (
                  <div key={s.id} style={adminCard}>
                    <h4 style={{margin: '0 0 8px 0', color: '#1e40af'}}>{s.ad}</h4>
                    <p style={{fontSize: '0.8rem', color: '#666', margin: '0 0 10px 0'}}>{YAPI_KATALOGU[s.tur]} {s.tur} {s.yil && `• ${s.yil}`}</p>
                    {s.fotolar && s.fotolar.length > 0 && (
                      <img src={typeof s.fotolar[0] === 'string' ? s.fotolar[0] : s.fotolar[0].data} onClick={() => setZoomPhoto(typeof s.fotolar[0] === 'string' ? s.fotolar[0] : s.fotolar[0].data)} style={{width: '100%', height: '140px', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in', marginBottom: '10px'}} alt={s.ad} />
                    )}
                    <button 
                      onClick={() => {
                        setViewState({ longitude: s.koordinat.lng, latitude: s.koordinat.lat, zoom: 17 });
                        setSecilenNokta({ lng: s.koordinat.lng, lat: s.koordinat.lat });
                        setActiveTab('map');
                      }} 
                      style={{...actionBtn, padding: '10px', fontSize: '0.85rem'}}
                    >
                      📍 Haritada Git
                    </button>
                  </div>
              ))}
              {allStructures.filter(s => activeFiltreler.includes(s.tur) && s.ad.toLowerCase().includes(listArama.toLowerCase())).length === 0 && (
                <p style={{color: '#94a3b8', width: '100%'}}>Arama kriterlerinize uygun yapı bulunamadı.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* --- MODALLAR --- */}
      {modalMode && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            {/* Bunu bul ve değiştir: */}
<button onClick={() => { setModalMode(null); window.speechSynthesis.cancel(); setIsSesliOkunuyor(false); setSecilenDosyalar([]); }} style={closeBtn}>✕</button>
            
            {modalMode === 'login' && (
          <div style={{width: '100%'}}>
            <h3 style={{marginBottom: '20px'}}>Sisteme Giriş</h3>
            <input id="loginEmail" placeholder="E-posta" style={fIn} />
            <input id="loginPass" type="password" placeholder="Şifre" style={fIn} />
            <button onClick={handleLogin} style={actionBtn}>Giriş Yap</button>
            <button onClick={handleResetPassword} style={{background: 'transparent', border: 'none', color: '#1e40af', fontSize: '0.8rem', width: '100%', marginTop: '10px', cursor: 'pointer', textDecoration: 'underline'}}>Şifremi Unuttum</button>
          </div>
        )}

            {modalMode === 'register' && (
              <form onSubmit={handleRegister} style={{width: '100%'}}>
                <h3 style={{marginBottom: '20px'}}>Yeni Üye Başvurusu</h3>
                <input required name="adSoyad" placeholder="Ad Soyad" style={fIn} />
                <input required name="email" type="email" placeholder="E-posta" style={fIn} />
                <input required name="sifre" type="password" placeholder="Şifre" style={fIn} />
                <input required name="ogrenciNo" placeholder="Öğrenci No" style={fIn} />
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
                <label style={{fontSize: '0.75rem', color: '#666', display: 'block', marginBottom: '5px', marginTop: '15px'}}>Fotoğrafları Seçin (Çoklu seçebilirsiniz):</label>
                <input required type="file" multiple style={fIn} onChange={(e) => setSecilenDosyalar(Array.from(e.target.files).map(f => ({ file: f, yil: '', ay: '', gun: '', tur: '', kaynak: '' })))} />
                
                {secilenDosyalar.length > 0 && (
                  <div style={{marginBottom: '15px', maxHeight: '250px', overflowY: 'auto', padding: '10px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0'}}>
                    <label style={{...checkTitle, marginBottom: '10px'}}>Seçtiğiniz Her Fotoğraf İçin Detayları Girin:</label>
                    {secilenDosyalar.map((dosya, i) => (
                      <div key={i} style={{marginBottom: '10px', padding: '10px', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)'}}>
                        <p style={{fontSize: '0.75rem', fontWeight: 'bold', margin: '0 0 8px 0', color: '#1e40af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>📷 {dosya.file.name}</p>
                        <div style={{display: 'flex', gap: '5px', marginBottom: '5px'}}>
                          <select value={dosya.yil} onChange={e => updateDosyaMeta(i, 'yil', e.target.value)} style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}}>
                            <option value="">Yıl</option>
                            {FOTO_YILLARI.map(y => <option key={y} value={y}>{y}</option>)}
                          </select>
                          <select value={dosya.ay} onChange={e => updateDosyaMeta(i, 'ay', e.target.value)} style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}}>
                            <option value="">Ay</option>
                            {FOTO_AYLARI.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <select value={dosya.gun} onChange={e => updateDosyaMeta(i, 'gun', e.target.value)} style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}}>
                            <option value="">Gün</option>
                            {FOTO_GUNLERI.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                        <div style={{display: 'flex', gap: '5px'}}>
                          <select value={dosya.tur} onChange={e => updateDosyaMeta(i, 'tur', e.target.value)} style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}}>
                            <option value="">Tür</option>
                            {FOTO_TURLERI.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <input value={dosya.kaynak} onChange={e => updateDosyaMeta(i, 'kaynak', e.target.value)} placeholder="Kaynak" style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                      <img src={typeof img === 'string' ? img : img.data} style={{height: '60px', borderRadius: '5px', objectFit: 'cover'}} alt="Yapı" />
                      {currentUser?.role === 'admin' && (
                        <button type="button" onClick={() => handleDeletePhoto(i)} style={{position: 'absolute', top: '-5px', right: '-5px', background: 'red', color: 'white', borderRadius: '50%', border: 'none', width: '20px', height: '20px', cursor: 'pointer', fontSize: '10px'}}>✕</button>
                      )}
                    </div>
                  ))}
                </div>

                <label style={{fontSize: '0.75rem', color: '#666', display: 'block', marginBottom: '5px', marginTop: '15px'}}>Fotoğrafları Seçin (Çoklu seçebilirsiniz):</label>
                <input required type="file" multiple style={fIn} onChange={(e) => setSecilenDosyalar(Array.from(e.target.files).map(f => ({ file: f, yil: '', ay: '', gun: '', tur: '', kaynak: '' })))} />
                
                {secilenDosyalar.length > 0 && (
                  <div style={{marginBottom: '15px', maxHeight: '250px', overflowY: 'auto', padding: '10px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0'}}>
                    <label style={{...checkTitle, marginBottom: '10px'}}>Seçtiğiniz Her Fotoğraf İçin Detayları Girin:</label>
                    {secilenDosyalar.map((dosya, i) => (
                      <div key={i} style={{marginBottom: '10px', padding: '10px', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)'}}>
                        <p style={{fontSize: '0.75rem', fontWeight: 'bold', margin: '0 0 8px 0', color: '#1e40af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>📷 {dosya.file.name}</p>
                        <div style={{display: 'flex', gap: '5px', marginBottom: '5px'}}>
                          <select value={dosya.yil} onChange={e => updateDosyaMeta(i, 'yil', e.target.value)} style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}}>
                            <option value="">Yıl</option>
                            {FOTO_YILLARI.map(y => <option key={y} value={y}>{y}</option>)}
                          </select>
                          <select value={dosya.ay} onChange={e => updateDosyaMeta(i, 'ay', e.target.value)} style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}}>
                            <option value="">Ay</option>
                            {FOTO_AYLARI.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <select value={dosya.gun} onChange={e => updateDosyaMeta(i, 'gun', e.target.value)} style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}}>
                            <option value="">Gün</option>
                            {FOTO_GUNLERI.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                        <div style={{display: 'flex', gap: '5px'}}>
                          <select value={dosya.tur} onChange={e => updateDosyaMeta(i, 'tur', e.target.value)} style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}}>
                            <option value="">Tür</option>
                            {FOTO_TURLERI.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <input value={dosya.kaynak} onChange={e => updateDosyaMeta(i, 'kaynak', e.target.value)} placeholder="Kaynak" style={{...fIn, flex: 1, marginBottom: 0, padding: '6px', fontSize: '0.7rem'}} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                {/* WIKIPEDIA BİLGİ KUTUSU VE SESLİ OKUMA (MADDE 5 VE 6) */}
                <div style={{background: '#f8fafc', padding: '15px', borderRadius: '12px', marginBottom: '15px', border: '1px solid #e2e8f0'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                    <strong style={{fontSize: '0.8rem', color: '#1e40af'}}>🌐 Wikipedia Özeti</strong>
                    {wikiBilgi && !wikiBilgi.includes("aranıyor...") && !wikiBilgi.includes("bulunamadı") && (
                      <button onClick={() => handleSesliOku(wikiBilgi)} style={{background: isSesliOkunuyor ? '#ef4444' : '#10b981', color: 'white', border: 'none', padding: '5px 12px', borderRadius: '8px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold', display: 'flex', gap: '5px'}}>
                        {isSesliOkunuyor ? '⏹️ Durdur' : '🔊 Dinle'}
                      </button>
                    )}
                  </div>
                  <p style={{margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: '1.6', maxHeight: '180px', overflowY: 'auto', paddingRight: '5px'}}>{wikiBilgi}</p>
                </div>
                
                {/* GALERİ */}
                <div style={{display: 'flex', gap: '15px', overflowX: 'auto', padding: '10px 0', borderBottom: '1px solid #eee'}}>
  {detayYapi.fotolar?.map((imgObj, i) => {
    const isObj = typeof imgObj === 'object' && imgObj !== null;
    const imgSrc = isObj ? imgObj.data : imgObj;
    const meta = isObj ? imgObj.meta : null;
    return (
      <div key={i} style={{minWidth: '120px', maxWidth: '200px'}}>
        <img src={imgSrc} onClick={() => setZoomPhoto(imgSrc)} style={{height: '100px', width: '100%', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in'}} alt="Yapı" />
        {meta && (meta.yil || meta.tur || meta.kaynak) && (
          <div style={{fontSize: '0.65rem', color: '#64748b', marginTop: '5px', lineHeight: '1.3'}}>
            {meta.gun} {meta.ay} {meta.yil} {meta.tur && `• ${meta.tur}`} <br/>
            {meta.kaynak && `© ${meta.kaynak}`}
          </div>
        )}
      </div>
    );
  })}
</div>

                {/* DENETİM İZİ (KİM GÜNCELLEDİ?) */}
                {(detayYapi.lastUpdatedBy || detayYapi.ekleyenAd || detayYapi.ekleyen) && (
                  <div style={{marginTop: '15px', padding: '10px', background: '#f8fafc', borderRadius: '8px', borderLeft: '3px solid #10b981', fontSize: '0.75rem', color: '#475569'}}>
                    <strong>Son Güncelleyen:</strong> {detayYapi.lastUpdatedBy || detayYapi.ekleyenAd || (detayYapi.ekleyen ? detayYapi.ekleyen.split('@')[0] : 'Gizli Kullanıcı')} <br/>
                    <strong>Tarih:</strong> {detayYapi.lastUpdatedDate || "Orijinal Kayıt"}
                  </div>
                )}

{/* BEĞENİ BUTONLARI (MADDE 9) */}
                <div style={{display: 'flex', gap: '15px', marginTop: '15px', padding: '10px 0', borderTop: '1px solid #eee', borderBottom: '1px solid #eee'}}>
                  <button onClick={() => handleLikeDislike('like')} style={{background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', color: (detayYapi.likes || []).includes(currentUser?.email) ? '#10b981' : '#64748b'}}>
                    <span style={{fontSize: '1.2rem'}}>👍</span> <strong>{(detayYapi.likes || []).length}</strong> Beğeni
                  </button>
                  <button onClick={() => handleLikeDislike('dislike')} style={{background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', color: (detayYapi.dislikes || []).includes(currentUser?.email) ? '#ef4444' : '#64748b'}}>
                    <span style={{fontSize: '1.2rem'}}>👎</span> <strong>{(detayYapi.dislikes || []).length}</strong> Beğenmeme
                  </button>
                </div>

                {/* YORUMLAR (MADDE 10) */}
                <div style={{marginTop: '15px'}}>
                  <h4 style={{fontSize: '0.9rem', color: '#1e40af', marginBottom: '10px'}}>Yorumlar ({(detayYapi.comments || []).length})</h4>
                  <div style={{maxHeight: '150px', overflowY: 'auto', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '8px'}}>
                    {(detayYapi.comments || []).length === 0 ? (
                      <p style={{fontSize: '0.8rem', color: '#94a3b8', margin: 0}}>Henüz yorum yapılmamış. İlk yorumu siz yapın!</p>
                    ) : (
                      detayYapi.comments.map((c, i) => (
                        <div key={i} style={{background: '#f8fafc', padding: '10px', borderRadius: '10px', fontSize: '0.8rem'}}>
                          <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '4px'}}>
                            <strong style={{color: '#334155'}}>{c.user}</strong>
                            <span style={{color: '#94a3b8', fontSize: '0.7rem'}}>{c.date}</span>
                          </div>
                          <p style={{margin: 0, color: '#475569'}}>{c.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                  
                  {/* Yorum Ekleme Formu */}
                  {currentUser && currentUser.status === 'active' && (
                    <form onSubmit={handleAddComment} style={{display: 'flex', gap: '10px'}}>
                      <input name="comment" required placeholder="Yorumunuzu yazın..." style={{...fIn, marginBottom: 0, padding: '10px'}} />
                      <button type="submit" style={{...actionBtn, width: 'auto', padding: '10px 20px'}}>Gönder</button>
                    </form>
                  )}
                </div>

                <div style={{display: 'flex', gap: '10px', marginTop: '15px'}}>
                  <button onClick={() => window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${detayYapi.koordinat.lat},${detayYapi.koordinat.lng}`, '_blank')} style={{...streetBtn, marginTop: 0, flex: 1}}>
                    📷 Street View
                  </button>
                  {currentUser && currentUser.status === 'active' && (
                    <button onClick={() => setModalMode('editStructure')} style={{...streetBtn, marginTop: 0, flex: 1, background: '#1e40af'}}>
                      ✏️ Düzenle / Fotoğraf Ekle
                    </button>
                  )}
                  {currentUser?.role === 'admin' && (
                    <button onClick={() => handleDeleteStructure(detayYapi.id)} style={{...streetBtn, marginTop: 0, flex: 1, background: '#ef4444'}}>
                      🗑️ Yapıyı Sil
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
            <button onClick={() => window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${secilenNokta.lat},${secilenNokta.lng}`, '_blank')} style={{...miniBtn, background: '#334155'}}>📷 Sokak</button>
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
const navStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', background: 'white', borderBottom: '1px solid #e2e8f0', zIndex: 100, flexWrap: 'wrap', gap: '10px' };
const menuItem = (active) => ({ background: 'transparent', border: 'none', color: active ? '#1e40af' : '#64748b', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' });
const loginBtn = { padding: '8px 20px', borderRadius: '10px', border: '1px solid #1e40af', color: '#1e40af', background: 'white', fontWeight: 'bold', cursor: 'pointer' };
const registerBtn = { padding: '8px 20px', borderRadius: '10px', border: 'none', background: '#1e40af', color: 'white', fontWeight: 'bold', cursor: 'pointer' };
const logoutBtn = { background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 15px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' };
const searchInput = { width: '100%', padding: '15px', borderRadius: '15px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', outline: 'none', boxSizing: 'border-box' };
const searchList = { background: 'white', marginTop: '5px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', overflow: 'hidden' };
const searchItem = { padding: '12px', fontSize: '0.8rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' };
const filterPanel = { position: 'absolute', top: 80, right: 15, background: 'white', padding: '15px', borderRadius: '20px', boxShadow: '0 4px 30px rgba(0,0,0,0.05)', width: '140px', zIndex: 10 };
const filterItem = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#475569', marginBottom: '8px', cursor: 'pointer' };
const modalOverlay = { position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 };
const modalBox = { background: 'white', padding: '25px', borderRadius: '20px', width: '95%', maxWidth: '450px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 25px 50px rgba(0,0,0,0.15)', boxSizing: 'border-box' };
const fIn = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '15px', outline: 'none', boxSizing: 'border-box' };
const actionBtn = { width: '100%', padding: '15px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', boxSizing: 'border-box' };
const closeBtn = { position: 'absolute', top: 20, right: 20, border: 'none', background: '#f1f5f9', width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', zIndex: 10 };
const contentPage = { padding: '20px', overflowY: 'auto', height: 'calc(100vh - 70px)', boxSizing: 'border-box', maxWidth: '1200px', margin: '0 auto' };
const adminGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' };
const adminCard = { background: 'white', padding: '15px', borderRadius: '15px', border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' };
const compactImg = { width: '70px', height: '70px', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in' };
const approveBtnMini = { padding: '8px 15px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', width: '100%' };
const sectionTitle = { fontSize: '1rem', color: '#94a3b8', fontWeight: '800', marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '1px' };
const infoBox = { position: 'absolute', bottom: 20, left: '5%', background: 'white', padding: '20px', borderRadius: '20px', boxShadow: '0 20px 50px rgba(0,0,0,0.1)', width: '90%', maxWidth: '320px', boxSizing: 'border-box', zIndex: 10 };
const miniBtn = { flex: 1, padding: '12px', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' };
const streetBtn = { width: '100%', padding: '15px', background: '#334155', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', marginTop: '15px', cursor: 'pointer' };
const checkTitle = { fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '8px', fontWeight: 'bold' };
const checkGroup = { display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' };
const checkItem = { fontSize: '0.8rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' };
const tagStyle = { fontSize: '0.75rem', background: '#f1f5f9', color: '#334155', padding: '4px 8px', borderRadius: '6px' };