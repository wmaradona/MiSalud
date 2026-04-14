const SUPABASE_URL = 'https://tizolwdbmgyunajycmyn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpem9sd2RibWd5dW5hanljbXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1OTQzOTAsImV4cCI6MjA5MTE3MDM5MH0.4BdXOkCwcEMtuArDhLvtxcllHm4Zn7l4iH-qgTzNz70';

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hash) {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

const app = {
  currentUser: null,
  state: { vistaActual: 'loading', filtroEstudios: 'todos' },
  SESSION_TIMEOUT_HOURS: 24,
  sessionInterval: null,

  async init() {
    this.setupEventListeners();
    this.setupActivityMonitor();
    this.startSessionMonitor();
    this.checkAuth();
  },

  setupActivityMonitor() {
    const resetActivity = () => {
      localStorage.setItem('lastActivity', Date.now().toString());
    };
    ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(event => {
      document.addEventListener(event, resetActivity, { passive: true });
    });
    resetActivity();
  },

  startSessionMonitor() {
    if (this.sessionInterval) clearInterval(this.sessionInterval);
    this.sessionInterval = setInterval(() => {
      const lastActivity = localStorage.getItem('lastActivity');
      if (lastActivity) {
        const hoursSinceActivity = (Date.now() - parseInt(lastActivity)) / (1000 * 60 * 60);
        if (hoursSinceActivity > this.SESSION_TIMEOUT_HOURS) {
          this.logout();
        }
      }
    }, 60000);
  },

  checkAuth() {
    const savedUser = localStorage.getItem('currentUser');
    const lastActivity = localStorage.getItem('lastActivity');
    
    if (savedUser && lastActivity) {
      const hoursSinceActivity = (Date.now() - parseInt(lastActivity)) / (1000 * 60 * 60);
      if (hoursSinceActivity > this.SESSION_TIMEOUT_HOURS) {
        this.logout();
        return;
      }
    }
    
    if (savedUser) {
      try {
        this.currentUser = JSON.parse(savedUser);
        if (this.currentUser && this.currentUser.id) {
          this.showApp();
          this.navigate('inicio');
          return;
        }
      } catch (e) {}
    }
    this.navigate('login');
  },

  async register(email, password, nombre) {
    try {
      console.log('Register attempt:', email, nombre);
      const { data: existing, error: checkError } = await supabaseClient
        .from('usuarios')
        .select('id')
        .eq('email', email);
      
      if (checkError) {
        console.error('Check error:', checkError);
        throw checkError;
      }
      
      if (existing && existing.length > 0) {
        return { success: false, error: 'El email ya está registrado' };
      }
      
      const passwordHash = await hashPassword(password);
      console.log('Password hash:', passwordHash);
      
      const { data, error } = await supabaseClient
        .from('usuarios')
        .insert([{
          email,
          nombre,
          password: passwordHash
        }]);
      
      console.log('Insert result:', data, error);
      if (error) throw error;
      
      const { data: newUser } = await supabaseClient
        .from('usuarios')
        .select('*')
        .eq('email', email)
        .single();
      
      this.currentUser = { 
        id: newUser.id, 
        email: newUser.email, 
        nombre: newUser.nombre 
      };
      localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
      return { success: true, id: newUser.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async login(email, password) {
    try {
      console.log('Login attempt:', email);
      const { data, error } = await supabaseClient
        .from('usuarios')
        .select('*')
        .eq('email', email);
      
      if (error) {
        console.error('Login error:', error);
        throw error;
      }
      
      console.log('User data:', data);
      
      if (!data || data.length === 0) {
        return { success: false, error: 'Usuario no encontrado' };
      }
      
      const usuario = data[0];
      if (!usuario.password) {
        return { success: false, error: 'Usuario sin contraseña registrada' };
      }
      
      const passwordValida = await verifyPassword(password, usuario.password);
      
      if (!passwordValida) {
        return { success: false, error: 'Contraseña incorrecta' };
      }
      
      this.currentUser = { 
        id: usuario.id, 
        email: usuario.email, 
        nombre: usuario.nombre 
      };
      localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
      console.log('Login success:', this.currentUser);
      return { success: true, usuario: this.currentUser };
    } catch (err) {
      console.error('Login exception:', err);
      return { success: false, error: err.message };
    }
  },

  logout() {
    this.currentUser = null;
    localStorage.removeItem('currentUser');
    localStorage.removeItem('lastActivity');
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    this.hideApp();
    this.navigate('login');
  },

  navigate(vista, params = {}) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const viewEl = document.getElementById(`view-${vista}`);
    if (viewEl) {
      viewEl.classList.add('active');
      this.state.vistaActual = vista;
      this.cargarVista(vista, params);
    }
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.sidebar-nav .nav-item[data-view="${vista}"]`);
    if (navItem) navItem.classList.add('active');
    window.scrollTo(0, 0);
  },

  cargarVista(vista, params) {
    switch (vista) {
      case 'login':
      case 'register':
      case 'loading':
        break;
      case 'inicio':
        this.renderInicio();
        break;
      case 'estudios':
        this.state.filtroEstudios = 'todos';
        this.renderEstudios();
        break;
      case 'estudio-form':
        this.prepararFormularioEstudio(params.id);
        break;
      case 'estudio-detalle':
        this.prepararDetalleEstudio(params.id);
        break;
      case 'consultas':
        this.renderConsultas();
        break;
      case 'consulta-form':
        this.prepararFormularioConsulta(params.id);
        break;
      case 'consulta-detalle':
        this.prepararDetalleConsulta(params.id);
        break;
      case 'notas':
        this.renderNotas();
        break;
      case 'nota-form':
        this.prepararFormularioNota(params.id);
        break;
      case 'historial':
        this.renderHistorial();
        break;
      case 'reportes':
        this.renderReportes();
        break;
      case 'configuracion':
        this.renderConfiguracion();
        break;
    }
  },

  showApp() {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('main-content').classList.remove('hidden');
  },

  hideApp() {
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');
  },

  setupEventListeners() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        this.navigate(view);
      });
    });

    document.querySelectorAll('.filtro-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.filtroEstudios = btn.dataset.filtro;
        this.renderEstudios();
      });
    });
  },

  formatFecha(fecha) {
    if (!fecha) return '';
    const parts = fecha.split('-');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return fecha;
  },

  async renderInicio() {
    document.getElementById('user-nombre').textContent = this.currentUser?.nombre || 'Usuario';
    try {
      const estudios = await supabaseClient.from('estudios').select('*').eq('usuarioid', this.currentUser.id).order('fecha', { ascending: false });
      const consultas = await supabaseClient.from('consultas').select('*').eq('usuarioid', this.currentUser.id).order('fecha', { ascending: false });
      
      const estudiosCount = estudios.data?.length || 0;
      const consultasCount = consultas.data?.length || 0;
      
      document.getElementById('stat-estudios').textContent = estudiosCount;
      document.getElementById('stat-consultas').textContent = consultasCount;

      // Cargar nombres de especialidades y tipos
      const { data: especialidades } = await supabaseClient.from('especialidades').select('*').eq('usuarioid', this.currentUser.id);
      const { data: tipos } = await supabaseClient.from('tipos_estudio').select('*').eq('usuarioid', this.currentUser.id);
      const espMap = (especialidades || []).reduce((m, e) => { m[e.id] = e.nombre; return m; }, {});
      const tipoMap = (tipos || []).reduce((m, t) => { m[t.id] = t.nombre; return m; }, {});

      const ultimos = [...(estudios.data || []), ...(consultas.data || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5);
      const container = document.getElementById('ultimos-estudios-list');
      if (ultimos.length === 0) {
        container.innerHTML = '<p class="empty-text">No hay registros</p>';
      } else {
        container.innerHTML = ultimos.map(e => {
          const isConsulta = e.motivo !== undefined;
          let meta = '';
          if (isConsulta) {
            meta = e.especialidad_id ? espMap[e.especialidad_id] : '';
          } else {
            const parts = [e.especialidad_id ? espMap[e.especialidad_id] : '', e.tipo_estudio_id ? tipoMap[e.tipo_estudio_id] : ''].filter(Boolean).join(' - ');
            meta = parts;
          }
          return `
            <div class="timeline-item" onclick="app.navigate('${isConsulta ? 'consulta-detalle' : 'estudio-detalle'}', {id: '${e.id}'})">
              <div class="timeline-icon ${isConsulta ? 'consulta' : 'estudio'}">${isConsulta ? '🏥' : '📋'}</div>
              <div class="timeline-content">
                <strong>${e.nombre || e.motivo}</strong>
                <p>${this.formatFecha(e.fecha)}${meta ? ' • ' + meta : ''}</p>
              </div>
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Error renderInicio:', err);
    }
  },

async renderEstudios(busqueda = '') {
    const container = document.getElementById('estudios-list');
    if (!container) return;
    container.innerHTML = '<p class="empty-text">Cargando...</p>';
    
    try {
      // Cargar especialidades y tipos una sola vez
      const { data: especialidades } = await supabaseClient
        .from('especialidades')
        .select('*')
        .eq('usuarioid', this.currentUser.id)
        .order('nombre');
      
      // Generar filtros dinámicamente
      const filtrosContainer = document.getElementById('estudios-filtros');
      if (filtrosContainer) {
        const botones = '<button class="filtro-btn active" data-filtro="todos">Todos</button>' +
          (especialidades || []).map(e => `<button class="filtro-btn" data-filtro="${e.id}">${e.nombre}</button>`).join('');
        filtrosContainer.innerHTML = botones;
        
        // Re-attach event listeners
        filtrosContainer.querySelectorAll('.filtro-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            filtrosContainer.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.state.filtroEstudios = btn.dataset.filtro;
            this.renderEstudios();
          });
        });
      }
      
      if (!this.state.filtroEstudios) this.state.filtroEstudios = 'todos';
      
      // Cargar estudios
      let query = supabaseClient
        .from('estudios')
        .select('*')
        .eq('usuarioid', this.currentUser.id);
      
      if (this.state.filtroEstudios !== 'todos') {
        query = query.eq('especialidad_id', this.state.filtroEstudios);
      }
      
      const { data: estudios } = await query.order('fecha', { ascending: false });
      
      // Cargar tipos para mostrar nombres
      const { data: tipos } = await supabaseClient
        .from('tipos_estudio')
        .select('*')
        .eq('usuarioid', this.currentUser.id);
      
      const espMap = (especialidades || []).reduce((m, e) => { m[e.id] = e.nombre; return m; }, {});
      const tipoMap = (tipos || []).reduce((m, t) => { m[t.id] = t.nombre; return m; }, {});
      
      if (!estudios || estudios.length === 0) {
        container.innerHTML = '<p class="empty-text">No hay estudios</p>';
        return;
      }
      
      let filtered = estudios;
      if (busqueda) {
        const term = busqueda.toLowerCase();
        filtered = filtered.filter(e => e.nombre.toLowerCase().includes(term));
      }

      if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-text">No hay estudios</p>';
      } else {
        container.innerHTML = filtered.map(e => `
          <div class="card" onclick="app.navigate('estudio-detalle', {id: '${e.id}'})">
            <div class="card-header">
              <div class="card-icon">${e.archivo ? '📎' : '📋'}</div>
              <div class="card-title"><h3>${e.nombre}</h3><p>${this.formatFecha(e.fecha)}</p></div>
            </div>
            <div class="card-body">
              ${e.especialidad_id ? `<span class="tag">${espMap[e.especialidad_id] || 'Especialidad'}</span>` : ''}
              ${e.tipo_estudio_id ? `<span class="tag">${tipoMap[e.tipo_estudio_id] || 'Tipo'}</span>` : ''}
              ${e.archivo ? '<span class="tag archivo-tag">📎 Adjunto</span>' : ''}
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      container.innerHTML = '<p class="error-text">Error: ' + err.message + '</p>';
    }
  },

  buscarEstudios() {
    this.renderEstudios(document.getElementById('estudios-search').value);
  },

  async renderConsultas(busqueda = '') {
    const container = document.getElementById('consultas-list');
    try {
      const { data: consultas } = await supabaseClient.from('consultas').select('*').eq('usuarioid', this.currentUser.id).order('fecha', { ascending: false });
      const { data: especialidades } = await supabaseClient.from('especialidades').select('*').eq('usuarioid', this.currentUser.id);
      const espMap = (especialidades || []).reduce((m, e) => { m[e.id] = e.nombre; return m; }, {});
      
      if (!consultas) {
        container.innerHTML = '<p class="error-text">Error cargando consultas</p>';
        return;
      }
      
      let filtered = consultas;
      if (busqueda) {
        const term = busqueda.toLowerCase();
        filtered = filtered.filter(c => (c.motivo || '').toLowerCase().includes(term) || (c.medico || '').toLowerCase().includes(term));
      }

      if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-text">No hay consultas</p>';
      } else {
        container.innerHTML = filtered.map(c => `
          <div class="card" onclick="app.navigate('consulta-detalle', {id: '${c.id}'})">
            <div class="card-header">
              <div class="card-icon">🏥</div>
              <div class="card-title"><h3>${c.motivo || 'Consulta'}</h3><p>${this.formatFecha(c.fecha)}</p></div>
            </div>
            <div class="card-body">
              ${c.especialidad_id ? `<span class="tag">${espMap[c.especialidad_id] || 'Especialidad'}</span>` : ''}
              ${c.medico ? `<span class="tag">👨‍⚕️ ${c.medico}</span>` : ''}
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      container.innerHTML = '<p class="error-text">Error: ' + err.message + '</p>';
    }
  },

  buscarConsultas() {
    this.renderConsultas(document.getElementById('consultas-search').value);
  },

  async prepararFormularioEstudio(id = null) {
    const archivoActual = document.getElementById('archivo-actual');
    if (archivoActual) archivoActual.textContent = '';
    
    document.getElementById('estudio-form-titulo').textContent = id ? 'Editar Estudio' : 'Nuevo Estudio';
    
    // Cargar especialidades en el select
    await this.cargarEspecialidadesSelect();
    
    if (id) {
      const { data: estudio } = await supabaseClient.from('estudios').select('*').eq('id', id).single();
      if (estudio) {
        document.getElementById('estudio-id').value = id;
        document.getElementById('estudio-especialidad').value = estudio.especialidad_id || '';
        await this.cargarTiposEstudio();
        document.getElementById('estudio-tipo-estudio').value = estudio.tipo_estudio_id || '';
        document.getElementById('estudio-nombre').value = estudio.nombre;
        document.getElementById('estudio-fecha').value = estudio.fecha;
        document.getElementById('estudio-lugar').value = estudio.lugar || '';
        document.getElementById('estudio-medico').value = estudio.medico || '';
        document.getElementById('estudio-resultado').value = estudio.resultado || '';
        document.getElementById('estudio-observaciones').value = estudio.observaciones || '';
        
        if (estudio.archivo) {
          const ext = estudio.archivonombre?.split('.').pop().toLowerCase();
          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
          const archivoUrl = estudio.archivo;
          
          if (archivoActual) {
            archivoActual.innerHTML = `
              <div class="archivo-preview-container">
                ${isImage 
                  ? `<img src="${archivoUrl}" alt="Archivo" class="archivo-preview-img" onclick="window.open('${archivoUrl}', '_blank')"/>`
                  : `<a href="${archivoUrl}" target="_blank" class="archivo-link">📎 ${estudio.archivonombre || 'Ver archivo'}</a>`
                }
              </div>
            `;
          }
        }
      }
    } else {
      document.getElementById('estudio-form').reset();
      document.getElementById('estudio-id').value = '';
      document.getElementById('estudio-fecha').value = new Date().toISOString().split('T')[0];
    }
  },
  
  async cargarEspecialidadesSelect() {
    const select = document.getElementById('estudio-especialidad');
    if (!select) return;
    
    const { data: especialidades } = await supabaseClient
      .from('especialidades')
      .select('*')
      .eq('usuarioid', this.currentUser.id)
      .order('nombre');
    
    select.innerHTML = '<option value="">Seleccionar especialidad</option>' + 
      (especialidades || []).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
  },
  
  async cargarTiposEstudio() {
    const select = document.getElementById('estudio-tipo-estudio');
    if (!select) return;
    
    const especialidadId = document.getElementById('estudio-especialidad')?.value;
    if (!especialidadId) {
      select.innerHTML = '<option value="">Primero seleccione especialidad</option>';
      return;
    }
    
    const { data: tipos } = await supabaseClient
      .from('tipos_estudio')
      .select('*')
      .eq('usuarioid', this.currentUser.id)
      .order('nombre');
    
    select.innerHTML = '<option value="">Seleccionar tipo</option>' + 
      (tipos || []).map(t => `<option value="${t.id}">${t.nombre}</option>`).join('');
  },

  async guardarEstudio(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '⏳ Guardando estudio...';
    submitBtn.disabled = true;
    
    const id = document.getElementById('estudio-id').value;
    const fileInput = document.getElementById('estudio-archivo');
    const archivoFile = fileInput?.files[0];
    
    let archivoUrl = null;
    let archivonombre = null;
    
    if (archivoFile) {
      try {
        const fileName = `${Date.now()}-${archivoFile.name}`;
        const { data: uploadData, error: uploadError } = await supabaseClient.storage
          .from('archivos')
          .upload(fileName, archivoFile);
        
        if (uploadError) throw uploadError;
        
        const { data: urlData } = supabaseClient.storage
          .from('archivos')
          .getPublicUrl(fileName);
        
        archivoUrl = urlData.publicUrl;
        archivonombre = archivoFile.name;
      } catch (err) {
        console.error('Error uploading file:', err);
      }
    }
    
    const data = {
      usuarioid: this.currentUser.id,
      especialidad_id: document.getElementById('estudio-especialidad').value || null,
      tipo_estudio_id: document.getElementById('estudio-tipo-estudio').value || null,
      nombre: document.getElementById('estudio-nombre').value,
      fecha: document.getElementById('estudio-fecha').value,
      lugar: document.getElementById('estudio-lugar').value || null,
      medico: document.getElementById('estudio-medico').value || null,
      resultado: document.getElementById('estudio-resultado').value || null,
      observaciones: document.getElementById('estudio-observaciones').value || null
    };
    
    if (archivoUrl) {
      data.archivo = archivoUrl;
      data.archivonombre = archivonombre;
    }

    try {
      let result;
      if (id) {
        if (archivoUrl) {
          const { data: oldEstudio } = await supabaseClient.from('estudios').select('archivo').eq('id', id).single();
          if (oldEstudio?.archivo) {
            try {
              const urlParts = oldEstudio.archivo.split('/');
              const oldFileName = decodeURIComponent(urlParts[urlParts.length - 1]);
              await supabaseClient.storage.from('archivos').remove([oldFileName]);
            } catch (e) {}
          }
        }
        result = await supabaseClient.from('estudios').update(data).eq('id', id);
      } else {
        result = await supabaseClient.from('estudios').insert([data]);
      }
      
      if (result.error) throw result.error;
      
      this.navigate('estudios');
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      if (submitBtn) {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    }
  },

  async prepararDetalleEstudio(id) {
    const numId = parseInt(id);
    const { data: estudio } = await supabaseClient.from('estudios').select('*').eq('id', numId).single();
    if (!estudio) return;

    // Cargar nombres de especialidad y tipo
    let espNombre = '', tipoNombre = '';
    if (estudio.especialidad_id) {
      const { data: esp } = await supabaseClient.from('especialidades').select('nombre').eq('id', estudio.especialidad_id).single();
      espNombre = esp?.nombre || '';
    }
    if (estudio.tipo_estudio_id) {
      const { data: tipo } = await supabaseClient.from('tipos_estudio').select('nombre').eq('id', estudio.tipo_estudio_id).single();
      tipoNombre = tipo?.nombre || '';
    }

    document.getElementById('estudio-detalle-nombre').textContent = estudio.nombre;
    document.getElementById('estudio-detalle-tipo').textContent = espNombre + (tipoNombre ? ' - ' + tipoNombre : '');
    document.getElementById('estudio-detalle-fecha').textContent = this.formatFecha(estudio.fecha);
    document.getElementById('estudio-detalle-lugar').textContent = estudio.lugar || '-';
    document.getElementById('estudio-detalle-medico').textContent = estudio.medico || '-';
    document.getElementById('estudio-detalle-resultado').textContent = estudio.resultado || 'Sin resultados';
    document.getElementById('estudio-detalle-observaciones').textContent = estudio.observaciones || 'Sin observaciones';

    const archivoContainer = document.getElementById('estudio-detalle-archivo');
    if (estudio.archivo && archivoContainer) {
      const ext = estudio.archivonombre?.split('.').pop().toLowerCase();
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
      archivoContainer.innerHTML = `
        <div class="archivo-section">
          <h3>Archivo Adjunto</h3>
          ${isImage 
            ? `<img src="${estudio.archivo}" alt="Archivo" class="archivo-preview-img" onclick="window.open('${estudio.archivo}', '_blank')"/>`
            : `<a href="${estudio.archivo}" target="_blank" class="archivo-link">📎 ${estudio.archivonombre || 'Ver archivo'}</a>`
          }
        </div>
      `;
    } else if (archivoContainer) {
      archivoContainer.innerHTML = '';
    }

    document.getElementById('btn-editar-estudio').onclick = () => this.navigate('estudio-form', { id: numId });
    document.getElementById('btn-eliminar-estudio').onclick = () => this.eliminarEstudio(numId);
  },

  async eliminarEstudio(id) {
    if (confirm('¿Eliminar este estudio?')) {
      try {
        const { data: estudio } = await supabaseClient.from('estudios').select('*').eq('id', id).single();
        
        if (estudio?.archivo) {
          try {
            const urlParts = estudio.archivo.split('/');
            const fileName = decodeURIComponent(urlParts[urlParts.length - 1]);
            await supabaseClient.storage.from('archivos').remove([fileName]);
          } catch (e) {
            console.log('File delete skipped');
          }
        }
        
        const result = await supabaseClient.from('estudios').delete().eq('id', id);
        if (result.error) throw result.error;
        this.navigate('estudios');
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
  },

  async prepararFormularioConsulta(id = null) {
    // Cargar especialidades
    const { data: especialidades } = await supabaseClient
      .from('especialidades')
      .select('*')
      .eq('usuarioid', this.currentUser.id)
      .order('nombre');
    
    const espSelect = document.getElementById('consulta-especialidad');
    if (espSelect) {
      espSelect.innerHTML = '<option value="">Seleccionar</option>' + 
        (especialidades || []).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
    }
    
    if (id) {
      const { data: consulta } = await supabaseClient.from('consultas').select('*').eq('id', parseInt(id)).single();
      if (consulta) {
        document.getElementById('consulta-form-titulo').textContent = 'Editar Consulta';
        document.getElementById('consulta-id').value = id;
        document.getElementById('consulta-fecha').value = consulta.fecha;
        document.getElementById('consulta-especialidad').value = consulta.especialidad_id || '';
        document.getElementById('consulta-medico').value = consulta.medico || '';
        document.getElementById('consulta-lugar').value = consulta.lugar || '';
        document.getElementById('consulta-motivo').value = consulta.motivo || '';
        document.getElementById('consulta-diagnostico').value = consulta.diagnostico || '';
        document.getElementById('consulta-tratamiento').value = consulta.tratamiento || '';
        document.getElementById('consulta-proximo').value = consulta.proximocontrol || '';
      }
    } else {
      document.getElementById('consulta-form').reset();
      document.getElementById('consulta-id').value = '';
      document.getElementById('consulta-fecha').value = new Date().toISOString().split('T')[0];
      document.getElementById('consulta-form-titulo').textContent = 'Nueva Consulta';
    }
  },

  async guardarConsulta(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '⏳ Guardando consulta...';
    submitBtn.disabled = true;
    
    const id = document.getElementById('consulta-id').value;
    const data = {
      usuarioid: this.currentUser.id,
      fecha: document.getElementById('consulta-fecha').value,
      motivo: document.getElementById('consulta-motivo').value || null,
      diagnostico: document.getElementById('consulta-diagnostico').value || null,
      medico: document.getElementById('consulta-medico').value || null,
      especialidad_id: document.getElementById('consulta-especialidad').value || null,
      lugar: document.getElementById('consulta-lugar').value || null,
      tratamiento: document.getElementById('consulta-tratamiento').value || null,
      proximocontrol: document.getElementById('consulta-proximo').value || null
    };

    try {
      let result;
      if (id) {
        result = await supabaseClient.from('consultas').update(data).eq('id', id);
      } else {
        result = await supabaseClient.from('consultas').insert([data]);
      }
      
      if (result.error) throw result.error;
      
      this.navigate('consultas');
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      if (submitBtn) {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    }
  },

  async prepararDetalleConsulta(id) {
    const numId = parseInt(id);
    const { data: consulta } = await supabaseClient.from('consultas').select('*').eq('id', numId).single();
    if (!consulta) return;
    
    document.getElementById('consulta-detalle-fecha').textContent = this.formatFecha(consulta.fecha);
    document.getElementById('consulta-detalle-especialidad').textContent = consulta.especialidad || '-';
    document.getElementById('consulta-detalle-medico').textContent = consulta.medico || '-';
    document.getElementById('consulta-detalle-lugar').textContent = consulta.lugar || '-';
    document.getElementById('consulta-detalle-motivo').textContent = consulta.motivo || '-';
    document.getElementById('consulta-detalle-diagnostico').textContent = consulta.diagnostico || '-';
    document.getElementById('consulta-detalle-tratamiento').textContent = consulta.tratamiento || '-';
    document.getElementById('consulta-detalle-proximo').textContent = consulta.proximocontrol || '-';
    document.getElementById('btn-editar-consulta').onclick = () => this.navigate('consulta-form', { id: numId });
    document.getElementById('btn-eliminar-consulta').onclick = () => this.eliminarConsulta(numId);
  },

  async eliminarConsulta(id) {
    if (confirm('¿Eliminar?')) {
      try {
        const result = await supabaseClient.from('consultas').delete().eq('id', id);
        if (result.error) throw result.error;
        this.navigate('consultas');
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
  },

  async renderHistorial(busqueda = '') {
    const container = document.getElementById('historial-list');
    try {
      const estudios = await supabaseClient.from('estudios').select('*').eq('usuarioid', this.currentUser.id);
      const consultas = await supabaseClient.from('consultas').select('*').eq('usuarioid', this.currentUser.id);
      
      const { data: especialidades } = await supabaseClient.from('especialidades').select('*').eq('usuarioid', this.currentUser.id);
      const { data: tipos } = await supabaseClient.from('tipos_estudio').select('*').eq('usuarioid', this.currentUser.id);
      const espMap = (especialidades || []).reduce((m, e) => { m[e.id] = e.nombre; return m; }, {});
      const tipoMap = (tipos || []).reduce((m, t) => { m[t.id] = t.nombre; return m; }, {});
      
      const merged = [...(estudios.data || []).map(e => ({...e, tipo: 'estudio'})), ...(consultas.data || []).map(c => ({...c, tipo: 'consulta'}))].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      let filtered = merged;
      if (busqueda) {
        const term = busqueda.toLowerCase();
        filtered = merged.filter(i => (i.nombre || '').toLowerCase().includes(term) || (i.motivo || '').toLowerCase().includes(term));
      }

      if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-text">No hay registros</p>';
      } else {
        container.innerHTML = filtered.map(item => {
          const isConsulta = item.tipo === 'consulta';
          const title = item.nombre || item.motivo || 'Sin título';
          let meta = '';
          if (isConsulta) {
            meta = item.especialidad_id ? espMap[item.especialidad_id] : '';
          } else {
            const parts = [item.especialidad_id ? espMap[item.especialidad_id] : '', item.tipo_estudio_id ? tipoMap[item.tipo_estudio_id] : ''].filter(Boolean);
            meta = parts.join(' - ');
          }
          return `
            <div class="timeline-item" onclick="app.navigate('${isConsulta ? 'consulta-detalle' : 'estudio-detalle'}', {id: '${item.id}'})">
              <div class="timeline-icon ${isConsulta ? 'consulta' : 'estudio'}">${isConsulta ? '🏥' : '📋'}</div>
              <div class="timeline-content">
                <strong>${title}</strong>
                <p>${this.formatFecha(item.fecha)}${meta ? ' • ' + meta : ''}</p>
                ${item.diagnostico ? `<p class="diagnostico">${item.diagnostico}</p>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      container.innerHTML = '<p class="error-text">Error: ' + err.message + '</p>';
    }
  },

  buscarHistorial() {
    this.renderHistorial(document.getElementById('historial-search').value);
  },

  async renderNotas(busqueda = '') {
    if (!this.currentUser) return;
    try {
      const { data: notas } = await supabaseClient
        .from('notas')
        .select('*')
        .eq('usuarioid', this.currentUser.id)
        .order('fecha', { ascending: false });
      
      let filtered = notas || [];
      if (busqueda) {
        const q = busqueda.toLowerCase();
        filtered = filtered.filter(n => 
          (n.titulo || '').toLowerCase().includes(q) || 
          (n.contenido || '').toLowerCase().includes(q)
        );
      }
      
      const container = document.getElementById('notas-list');
      if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-text">No hay notas</p>';
      } else {
        container.innerHTML = filtered.map(n => `
          <div class="note-card">
            <div class="note-header">
              <div class="note-title">${n.titulo || 'Sin título'}</div>
              <div class="note-date">${this.formatFecha(n.fecha)}</div>
            </div>
            <div class="note-content">${n.contenido}</div>
            <div class="note-actions">
              <button class="btn-secondary btn-xs" onclick="app.navigate('nota-form', {id: '${n.id}'})">✏️</button>
              <button class="btn-danger btn-xs" onclick="app.eliminarNota(${n.id})">🗑️</button>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error('Error renderNotas:', err);
    }
  },

  buscarNotas() {
    this.renderNotas(document.getElementById('notas-search').value);
  },

  async prepararFormularioNota(id = null) {
    document.getElementById('nota-form-titulo').textContent = id ? 'Editar Nota' : 'Nueva Nota';
    
    if (id) {
      const { data: nota } = await supabaseClient.from('notas').select('*').eq('id', id).single();
      if (nota) {
        document.getElementById('nota-id').value = id;
        document.getElementById('nota-titulo').value = nota.titulo || '';
        document.getElementById('nota-fecha').value = nota.fecha;
        document.getElementById('nota-contenido').value = nota.contenido;
      }
    } else {
      document.getElementById('nota-form').reset();
      document.getElementById('nota-id').value = '';
      document.getElementById('nota-fecha').value = new Date().toISOString().split('T')[0];
    }
  },

  async guardarNota(e) {
    e.preventDefault();
    const id = document.getElementById('nota-id').value;
    const data = {
      usuarioid: this.currentUser.id,
      titulo: document.getElementById('nota-titulo').value || null,
      fecha: document.getElementById('nota-fecha').value,
      contenido: document.getElementById('nota-contenido').value
    };

    try {
      let result;
      if (id) {
        result = await supabaseClient.from('notas').update(data).eq('id', id);
      } else {
        result = await supabaseClient.from('notas').insert([data]);
      }
      
      if (result.error) throw result.error;
      this.navigate('notas');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  async eliminarNota(id) {
    if (!confirm('¿Eliminar esta nota?')) return;
    try {
      await supabaseClient.from('notas').delete().eq('id', id);
      this.renderNotas();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  async renderConfiguracion() {
    if (!this.currentUser) return;
    try {
      // Cargar especialidades
      const { data: especialidades } = await supabaseClient
        .from('especialidades')
        .select('*')
        .eq('usuarioid', this.currentUser.id)
        .order('nombre');
      
      const espList = document.getElementById('especialidades-list');
      if (espList) {
        espList.innerHTML = (especialidades || []).map(e => `
          <div class="item-row">
            <span>${e.nombre}</span>
            <button class="btn-danger btn-xs" onclick="app.eliminarEspecialidad(${e.id})">✕</button>
          </div>
        `).join('') || '<p class="empty-text">No hay especialidades agregadas</p>';
      }
      
      // Cargar tipos de estudio
      const { data: tipos } = await supabaseClient
        .from('tipos_estudio')
        .select('*')
        .eq('usuarioid', this.currentUser.id)
        .order('nombre');
      
      const tipoList = document.getElementById('tipos-estudio-list');
      if (tipoList) {
        tipoList.innerHTML = (tipos || []).map(t => `
          <div class="item-row">
            <span>${t.nombre}</span>
            <button class="btn-danger btn-xs" onclick="app.eliminarTipoEstudio(${t.id})">✕</button>
          </div>
        `).join('') || '<p class="empty-text">No hay tipos de estudio agregados</p>';
      }
      
      // Estadísticas
      const estudios = await supabaseClient.from('estudios').select('id', { count: 'exact', head: true }).eq('usuarioid', this.currentUser.id);
      const consultas = await supabaseClient.from('consultas').select('id', { count: 'exact', head: true }).eq('usuarioid', this.currentUser.id);
      
      document.querySelectorAll('#config-estudios').forEach(el => el.textContent = estudios.count || 0);
      document.querySelectorAll('#config-consultas').forEach(el => el.textContent = consultas.count || 0);
      
      const userText = this.currentUser?.nombre || this.currentUser?.email || 'No identificado';
      document.querySelectorAll('#config-usuario').forEach(el => el.textContent = userText);
    } catch (err) {
      console.error('Error renderConfiguracion:', err);
    }
  },
  
  async agregarEspecialidad() {
    const input = document.getElementById('new-especialidad');
    const nombre = input?.value?.trim();
    if (!nombre) return;
    
    try {
      const { error } = await supabaseClient.from('especialidades').insert([{
        usuarioid: this.currentUser.id,
        nombre
      }]);
      if (error) throw error;
      input.value = '';
      this.renderConfiguracion();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },
  
  async eliminarEspecialidad(id) {
    if (!confirm('¿Eliminar esta especialidad?')) return;
    try {
      const { data: estudios } = await supabaseClient.from('estudios').select('id').eq('especialidad_id', id);
      const { data: consultas } = await supabaseClient.from('consultas').select('id').eq('especialidad_id', id);
      
      if ((estudios?.length || 0) > 0 || (consultas?.length || 0) > 0) {
        alert('No se puede eliminar: está siendo usada en estudios o consultas.');
        return;
      }
      await supabaseClient.from('especialidades').delete().eq('id', id);
      this.renderConfiguracion();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },
  
  async agregarTipoEstudio() {
    const input = document.getElementById('new-tipo-estudio');
    const nombre = input?.value?.trim();
    if (!nombre) return;
    
    try {
      const { error } = await supabaseClient.from('tipos_estudio').insert([{
        usuarioid: this.currentUser.id,
        nombre
      }]);
      if (error) throw error;
      input.value = '';
      this.renderConfiguracion();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },
  
  async eliminarTipoEstudio(id) {
    if (!confirm('¿Eliminar este tipo de estudio?')) return;
    try {
      const { data: estudios } = await supabaseClient.from('estudios').select('id').eq('tipo_estudio_id', id);
      
      if ((estudios?.length || 0) > 0) {
        alert('No se puede eliminar: está siendo usado en estudios.');
        return;
      }
      await supabaseClient.from('tipos_estudio').delete().eq('id', id);
      this.renderConfiguracion();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  async renderReportes() {
    const desdeInput = document.getElementById('reporte-desde');
    const hastaInput = document.getElementById('reporte-hasta');
    if (!desdeInput.value) {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), 0, 1);
      desdeInput.value = firstDay.toISOString().split('T')[0];
      hastaInput.value = now.toISOString().split('T')[0];
    }
    
    // Cargar especialidades en filtro
    const { data: especialidades } = await supabaseClient
      .from('especialidades')
      .select('*')
      .eq('usuarioid', this.currentUser.id)
      .order('nombre');
    
    const espSelect = document.getElementById('reporte-especialidad');
    if (espSelect) {
      espSelect.innerHTML = '<option value="">Todas</option>' + 
        (especialidades || []).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
    }
    
    // Cargar tipos de estudio
    const { data: tipos } = await supabaseClient
      .from('tipos_estudio')
      .select('*')
      .eq('usuarioid', this.currentUser.id)
      .order('nombre');
    
    const tipoSelect = document.getElementById('reporte-tipo-estudio');
    if (tipoSelect) {
      tipoSelect.innerHTML = '<option value="">Todos</option>' + 
        (tipos || []).map(t => `<option value="${t.id}">${t.nombre}</option>`).join('');
    }
    
    await this.generarReporte();
  },
  
  async cargarTiposReporte() {
    const select = document.getElementById('reporte-tipo-estudio');
    if (!select) return;
    
    const { data: tipos } = await supabaseClient
      .from('tipos_estudio')
      .select('*')
      .eq('usuarioid', this.currentUser.id)
      .order('nombre');
    
    select.innerHTML = '<option value="">Todos</option>' + 
      (tipos || []).map(t => `<option value="${t.id}">${t.nombre}</option>`).join('');
  },

  async generarReporte() {
    const desde = document.getElementById('reporte-desde').value;
    const hasta = document.getElementById('reporte-hasta').value;
    const especialidadId = document.getElementById('reporte-especialidad').value;
    const tipoEstudioId = document.getElementById('reporte-tipo-estudio').value;
    
    if (!this.currentUser || !this.currentUser.id) return;
    
    const { data: especialidades } = await supabaseClient.from('especialidades').select('*').eq('usuarioid', this.currentUser.id);
    const { data: tipos } = await supabaseClient.from('tipos_estudio').select('*').eq('usuarioid', this.currentUser.id);
    const espMap = (especialidades || []).reduce((m, e) => { m[e.id] = e.nombre; return m; }, {});
    const tipoMap = (tipos || []).reduce((m, t) => { m[t.id] = t.nombre; return m; }, {});
    
    let queryEstudios = supabaseClient.from('estudios').select('*').eq('usuarioid', this.currentUser.id);
    let queryConsultas = supabaseClient.from('consultas').select('*').eq('usuarioid', this.currentUser.id);
    
    if (desde) queryEstudios = queryEstudios.gte('fecha', desde);
    if (hasta) queryEstudios = queryEstudios.lte('fecha', hasta);
    if (especialidadId) queryEstudios = queryEstudios.eq('especialidad_id', especialidadId);
    if (tipoEstudioId) queryEstudios = queryEstudios.eq('tipo_estudio_id', tipoEstudioId);
    
    if (desde) queryConsultas = queryConsultas.gte('fecha', desde);
    if (hasta) queryConsultas = queryConsultas.lte('fecha', hasta);
    if (especialidadId) queryConsultas = queryConsultas.eq('especialidad_id', especialidadId);
    
    const estudios = await queryEstudios;
    const consultas = await queryConsultas;
    
    const filteredEstudios = estudios.data || [];
    const filteredConsultas = consultas.data || [];
    
    document.getElementById('report-estudios').textContent = filteredEstudios.length;
    document.getElementById('report-consultas').textContent = filteredConsultas.length;
    
    const estudiosList = document.getElementById('report-estudios-list');
    if (filteredEstudios.length === 0) {
      estudiosList.innerHTML = '<p class="empty-text">No hay estudios en el período</p>';
    } else {
      estudiosList.innerHTML = filteredEstudios.map(e => {
        const meta = [e.especialidad_id ? espMap[e.especialidad_id] : '', e.tipo_estudio_id ? tipoMap[e.tipo_estudio_id] : ''].filter(Boolean).join(' - ');
        return `
          <div class="card">
            <div class="card-header">
              <div class="card-icon">📋</div>
              <div class="card-title"><h3>${e.nombre}</h3><p>${this.formatFecha(e.fecha)}${meta ? ' • ' + meta : ''}</p></div>
            </div>
            <div class="card-body">
              ${e.lugar ? `<span class="tag">📍 ${e.lugar}</span>` : ''}
              ${e.medico ? `<span class="tag">👨‍⚕️ ${e.medico}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
    
    const consultasList = document.getElementById('report-consultas-list');
    if (filteredConsultas.length === 0) {
      consultasList.innerHTML = '<p class="empty-text">No hay consultas en el período</p>';
    } else {
      consultasList.innerHTML = filteredConsultas.map(c => {
        const esp = c.especialidad_id ? espMap[c.especialidad_id] : '';
        return `
          <div class="card">
            <div class="card-header">
              <div class="card-icon">🏥</div>
              <div class="card-title"><h3>${c.motivo || 'Consulta'}</h3><p>${this.formatFecha(c.fecha)}${esp ? ' • ' + esp : ''}</p></div>
            </div>
            <div class="card-body">
              ${c.medico ? `<span class="tag">👨‍⚕️ ${c.medico}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
  },

  async exportarPDF() {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const pageCount = { current: 1 };
      const totalPages = { count: 1 };
      
      const header = async () => {
        doc.setFillColor(0, 102, 153);
        doc.rect(0, 0, 210, 45, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.text('Mi Salud', 15, 18);
        doc.setFontSize(10);
        doc.text('Historial Médico Personal', 15, 26);
        doc.setFontSize(8);
        doc.text(`Usuario: ${this.currentUser.nombre} (${this.currentUser.email})`, 15, 32);
        
        // Filtros aplicados
        const desde = document.getElementById('reporte-desde').value;
        const hasta = document.getElementById('reporte-hasta').value;
        const especialidadId = document.getElementById('reporte-especialidad').value;
        const tipoEstudioId = document.getElementById('reporte-tipo-estudio').value;
        
        let filtros = [];
        if (desde || hasta) {
          filtros.push('Fecha: ' + (desde ? this.formatFecha(desde) : 'inicio') + ' - ' + (hasta ? this.formatFecha(hasta) : 'hoy'));
        }
        
        if (especialidadId) {
          const { data: esp } = await supabaseClient.from('especialidades').select('nombre').eq('id', especialidadId).single();
          if (esp?.nombre) filtros.push('Especialidad: ' + esp.nombre);
        }
        
        if (tipoEstudioId) {
          const { data: tipo } = await supabaseClient.from('tipos_estudio').select('nombre').eq('id', tipoEstudioId).single();
          if (tipo?.nombre) filtros.push('Tipo: ' + tipo.nombre);
        }
        
        if (filtros.length > 0) {
          doc.setTextColor(200, 200, 200);
          doc.text('Filtros: ' + filtros.join(' | '), 15, 40);
        }
        doc.setTextColor(0, 0, 0);
      };
      
      const footer = () => {
        const pageSize = doc.internal.pageSize;
        const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(`Página ${pageCount.current} de ${totalPages.count}`, 105, pageHeight - 10, { align: 'center' });
        doc.text(`Generado el ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 195, pageHeight - 10, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      };
      
      doc.header = header;
      doc.footer = footer;
      await header();
      
      doc.setFontSize(11);
      doc.setTextColor(0, 102, 153);
      doc.text('ESTUDIOS MÉDICOS', 15, 50);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      
      let y = 60;
      
      const { data: estudios } = await supabaseClient.from('estudios').select('*').eq('usuarioid', this.currentUser.id).order('fecha', { ascending: false });
      const { data: especialidades } = await supabaseClient.from('especialidades').select('*').eq('usuarioid', this.currentUser.id);
      const { data: tipos } = await supabaseClient.from('tipos_estudio').select('*').eq('usuarioid', this.currentUser.id);
      const espMap = (especialidades || []).reduce((m, e) => { m[e.id] = e.nombre; return m; }, {});
      const tipoMap = (tipos || []).reduce((m, t) => { m[t.id] = t.nombre; return m; }, {});
      
      if (estudios && estudios.length > 0) {
        estudios.forEach(e => {
          if (y > 260) {
            doc.addPage();
            pageCount.current++;
            y = 40;
          }
          const meta = [e.especialidad_id ? espMap[e.especialidad_id] : '', e.tipo_estudio_id ? tipoMap[e.tipo_estudio_id] : '', e.lugar].filter(Boolean).join(' • ');
          doc.setFontSize(10);
          doc.setTextColor(0, 102, 153);
          doc.text(e.nombre, 15, y);
          doc.setTextColor(80, 80, 80);
          doc.setFontSize(8);
          doc.text(`${this.formatFecha(e.fecha)}${meta ? ' | ' + meta : ''}${e.medico ? ' | Dr. ' + e.medico : ''}`, 20, y + 5);
          if (e.resultado) {
            doc.text('Resultado: ' + e.resultado.substring(0, 80), 20, y + 10);
          }
          y += 15;
        });
      } else {
        doc.setFontSize(9);
        doc.setTextColor(128, 128, 128);
        doc.text('No hay estudios registrados', 15, y);
        y += 10;
      }
      
      y += 10;
      doc.setFontSize(11);
      doc.setTextColor(0, 102, 153);
      doc.text('CONSULTAS MÉDICAS', 15, y);
      y += 10;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      
      const { data: consultas } = await supabaseClient.from('consultas').select('*').eq('usuarioid', this.currentUser.id).order('fecha', { ascending: false });
      
      if (consultas && consultas.length > 0) {
        consultas.forEach(c => {
          if (y > 260) {
            doc.addPage();
            pageCount.current++;
            y = 40;
          }
          const esp = c.especialidad_id ? espMap[c.especialidad_id] : '';
          doc.setFontSize(10);
          doc.setTextColor(0, 102, 153);
          doc.text(c.motivo, 15, y);
          doc.setTextColor(80, 80, 80);
          doc.setFontSize(8);
          doc.text(`${this.formatFecha(c.fecha)}${esp ? ' | ' + esp : ''}${c.medico ? ' | Dr. ' + c.medico : ''}`, 20, y + 5);
          if (c.diagnostico) {
            doc.text('Diagnóstico: ' + c.diagnostico.substring(0, 80), 20, y + 10);
          }
          if (c.tratamiento) {
            doc.text('Tratamiento: ' + c.tratamiento.substring(0, 80), 20, y + 15);
          }
          y += 18;
        });
      } else {
        doc.setFontSize(9);
        doc.setTextColor(128, 128, 128);
        doc.text('No hay consultas registradas', 15, y);
      }
      
      totalPages.count = pageCount.current;
      footer();
      
      doc.save(`historial-medico-${this.currentUser.email.split('@')[0]}-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      alert('Error al generar PDF: ' + err.message);
    }
  },

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    document.getElementById('login-error').textContent = 'Verificando...';
    try {
      const result = await this.login(email, password);
      if (result.success && this.currentUser && this.currentUser.id) {
        document.getElementById('login-error').textContent = '';
        this.showApp();
        this.navigate('inicio');
      } else {
        document.getElementById('login-error').textContent = result.error || 'Credenciales inválidas';
      }
    } catch (err) {
      document.getElementById('login-error').textContent = 'Error: ' + err.message;
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    const nombre = document.getElementById('register-nombre').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    document.getElementById('register-error').textContent = 'Registrando...';
    try {
      const result = await this.register(email, password, nombre);
      if (result.success && this.currentUser && this.currentUser.id) {
        document.getElementById('register-error').textContent = '';
        this.showApp();
        this.navigate('inicio');
      } else {
        document.getElementById('register-error').textContent = result.error || 'Error al registrar';
        this.currentUser = null;
      }
    } catch (err) {
      document.getElementById('register-error').textContent = 'Error: ' + err.message;
    }
  },

  getTipoLabel(tipo) {
    const labels = {
      laboratorio: 'Laboratorio', imagenes: 'Imágenes', ecografia: 'Ecografía',
      radiografia: 'Radiografía', tac: 'Tomografía', rmn: 'Resonancia',
      electrocardiograma: 'ECG', espirometria: 'Espirometría', densitometria: 'Densitometría',
      cardiologia: 'Cardiología', neurologia: 'Neurología', oncologia: 'Oncología',
      traumatologia: 'Traumatología', pediatria: 'Pediatría', obstetricia: 'Obstetricia',
      ginecologia: 'Ginecología', dermatologia: 'Dermatología', oftalmologia: 'Oftalmología',
      otorrinolaringologia: 'OTL', psiquiatria: 'Psiquiatría', psicologia: 'Psicología',
      nutriologia: 'Nutriología', altro: 'Otro'
    };
    return labels[tipo] || tipo;
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
