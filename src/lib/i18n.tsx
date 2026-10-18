import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "pt" | "en" | "es";
export const LANGS: { id: Lang; label: string; speech: string }[] = [
  { id: "pt", label: "Português", speech: "pt-BR" },
  { id: "en", label: "English", speech: "en-US" },
  { id: "es", label: "Español", speech: "es-ES" },
];

const dict = {
  pt: {
    nav_chat: "Conversa", nav_memory: "Memória", nav_agents: "Agentes", nav_bots: "Bots",
    nav_settings: "Configurações", connected: "Conectado ao Jarvis local", demo: "Modo demonstração",
    demo_hint: "Instale e rode o Jarvis no seu computador para ativar todas as funções.",
    placeholder: "Fale ou digite um comando…", send: "Enviar", listening: "Ouvindo", thinking: "Pensando",
    speaking: "Falando", idle: "Em espera", mic: "Microfone", stop: "Parar",
    approve: "Aprovar", deny: "Negar", pending_action: "Ação aguardando aprovação",
    approval_done: "Concluído", approval_error: "Falhou", approval_interrupted: "Interrompido — verifique", approval_denied: "Negado",
    reasoning: "Raciocínio", tools_used: "Ferramentas", new_chat: "Nova conversa",
    conversations: "Conversas", no_conversations: "Nenhuma conversa ainda. Envie uma mensagem para começar.",
    conversation_deleted: "Conversa excluída.", delete_conversation: "Excluir conversa",
    delete_conversation_confirm: "Excluir esta conversa e todas as mensagens? Esta ação não pode ser desfeita.",
    loading: "Carregando…", retry: "Tentar novamente", agent_default: "Padrão",
    send_failed: "Falha ao enviar — sua mensagem foi preservada. Tente novamente.",
    memory_title: "Memória", memory_sub: "Fatos e notas que o Jarvis consulta para decidir.",
    add: "Adicionar", save: "Salvar", delete: "Excluir", search: "Buscar", cancel: "Cancelar",
    content: "Conteúdo", tags: "Etiquetas", empty: "Nada por aqui ainda.",
    agents_title: "Agentes", agents_sub: "Personalidades com instruções, modelo e ferramentas próprias.",
    name: "Nome", instructions: "Instruções", model: "Modelo", provider: "Provedor", tools: "Ferramentas",
    templates: "Modelos de instruções", use_template: "Usar modelo", active: "Ativo", set_active: "Tornar ativo",
    bots_title: "Bots autônomos", bots_sub: "Tarefas que o Jarvis executa sozinho quando um gatilho dispara.",
    goal: "Objetivo", trigger: "Gatilho", autonomy: "Autonomia", max_steps: "Limite de passos",
    run_now: "Executar agora", pause: "Pausar", resume: "Retomar", runs: "Execuções",
    t_daily: "Diariamente às", t_interval: "A cada (minutos)", t_voice: "Comando de voz", t_file: "Arquivo alterado", t_message: "Mensagem recebida",
    a_confirm: "Pedir confirmação", a_safe: "Só ações seguras", a_full: "Autônomo total",
    settings_title: "Configurações", s_providers: "Provedores de IA", s_agents: "Integrações de agentes",
    s_comms: "Comunicação", s_voice: "Voz e ativação", s_general: "Geral", s_diagnostics: "Diagnóstico", api_key: "Chave de API",
    base_url: "URL base", default_model: "Modelo padrão", test: "Testar", enabled: "Habilitado",
    command: "Comando", language: "Idioma padrão", agent_name: "Nome do assistente",
    wake_methods: "Métodos de ativação", wake_clap: "Palmas duplas", wake_word: "Chamar pelo nome",
    wake_hotkey: "Atalho de teclado", wake_ptt: "Apertar para falar", sensitivity: "Sensibilidade",
    tts_engine: "Motor de voz", voice_clone: "Voz clonada", upload_voice: "Enviar amostra de voz",
    voice_hint: "Use 10 a 60 segundos de fala limpa em .wav, .mp3, .ogg, .flac ou .m4a.",
    bridge_url: "Endereço do Jarvis local", host_actions: "Ações no host", allowlist: "Comandos permitidos",
    saved: "Salvo", local_only: "Nada sai do seu computador, exceto chamadas ao provedor que você escolher.",
    calibrate: "Testar palmas", clap_detected: "Palmas detectadas!", download: "Baixar projeto",
  },
  en: {
    nav_chat: "Chat", nav_memory: "Memory", nav_agents: "Agents", nav_bots: "Bots",
    nav_settings: "Settings", connected: "Connected to local Jarvis", demo: "Demo mode",
    demo_hint: "Install and run Jarvis on your computer to unlock every feature.",
    placeholder: "Speak or type a command…", send: "Send", listening: "Listening", thinking: "Thinking",
    speaking: "Speaking", idle: "Standing by", mic: "Microphone", stop: "Stop",
    approve: "Approve", deny: "Deny", pending_action: "Action awaiting approval",
    approval_done: "Completed", approval_error: "Failed", approval_interrupted: "Interrupted — verify", approval_denied: "Denied",
    reasoning: "Reasoning", tools_used: "Tools", new_chat: "New chat",
    conversations: "Conversations", no_conversations: "No conversations yet. Send a message to start.",
    conversation_deleted: "Conversation deleted.", delete_conversation: "Delete conversation",
    delete_conversation_confirm: "Delete this conversation and all its messages? This cannot be undone.",
    loading: "Loading…", retry: "Retry", agent_default: "Default",
    send_failed: "Sending failed — your message was preserved. Try again.",
    memory_title: "Memory", memory_sub: "Facts and notes Jarvis consults to make decisions.",
    add: "Add", save: "Save", delete: "Delete", search: "Search", cancel: "Cancel",
    content: "Content", tags: "Tags", empty: "Nothing here yet.",
    agents_title: "Agents", agents_sub: "Personas with their own instructions, model and tools.",
    name: "Name", instructions: "Instructions", model: "Model", provider: "Provider", tools: "Tools",
    templates: "Instruction templates", use_template: "Use template", active: "Active", set_active: "Make active",
    bots_title: "Autonomous bots", bots_sub: "Tasks Jarvis runs on its own when a trigger fires.",
    goal: "Goal", trigger: "Trigger", autonomy: "Autonomy", max_steps: "Step limit",
    run_now: "Run now", pause: "Pause", resume: "Resume", runs: "Runs",
    t_daily: "Daily at", t_interval: "Every (minutes)", t_voice: "Voice command", t_file: "File changed", t_message: "Message received",
    a_confirm: "Ask for confirmation", a_safe: "Safe actions only", a_full: "Fully autonomous",
    settings_title: "Settings", s_providers: "AI providers", s_agents: "Agent integrations",
    s_comms: "Communication", s_voice: "Voice & wake", s_general: "General", s_diagnostics: "Diagnostics", api_key: "API key",
    base_url: "Base URL", default_model: "Default model", test: "Test", enabled: "Enabled",
    command: "Command", language: "Default language", agent_name: "Assistant name",
    wake_methods: "Wake methods", wake_clap: "Double clap", wake_word: "Call by name",
    wake_hotkey: "Keyboard shortcut", wake_ptt: "Push to talk", sensitivity: "Sensitivity",
    tts_engine: "Voice engine", voice_clone: "Cloned voice", upload_voice: "Upload voice sample",
    voice_hint: "Use 10–60 seconds of clean speech as .wav, .mp3, .ogg, .flac or .m4a.",
    bridge_url: "Local Jarvis address", host_actions: "Host actions", allowlist: "Allowed commands",
    saved: "Saved", local_only: "Nothing leaves your computer except calls to the provider you choose.",
    calibrate: "Test claps", clap_detected: "Claps detected!", download: "Download project",
  },
  es: {
    nav_chat: "Conversación", nav_memory: "Memoria", nav_agents: "Agentes", nav_bots: "Bots",
    nav_settings: "Configuración", connected: "Conectado a Jarvis local", demo: "Modo demostración",
    demo_hint: "Instala y ejecuta Jarvis en tu computadora para activar todas las funciones.",
    placeholder: "Habla o escribe un comando…", send: "Enviar", listening: "Escuchando", thinking: "Pensando",
    speaking: "Hablando", idle: "En espera", mic: "Micrófono", stop: "Detener",
    approve: "Aprobar", deny: "Rechazar", pending_action: "Acción esperando aprobación",
    approval_done: "Completado", approval_error: "Falló", approval_interrupted: "Interrumpido — verifique", approval_denied: "Rechazado",
    reasoning: "Razonamiento", tools_used: "Herramientas", new_chat: "Nueva conversación",
    conversations: "Conversaciones", no_conversations: "Aún no hay conversaciones. Envía un mensaje para empezar.",
    conversation_deleted: "Conversación eliminada.", delete_conversation: "Eliminar conversación",
    delete_conversation_confirm: "¿Eliminar esta conversación y todos los mensajes? Esta acción no se puede deshacer.",
    loading: "Cargando…", retry: "Reintentar", agent_default: "Predeterminado",
    send_failed: "Error al enviar — tu mensaje se conservó. Inténtalo de nuevo.",
    memory_title: "Memoria", memory_sub: "Hechos y notas que Jarvis consulta para decidir.",
    add: "Agregar", save: "Guardar", delete: "Eliminar", search: "Buscar", cancel: "Cancelar",
    content: "Contenido", tags: "Etiquetas", empty: "Nada aquí todavía.",
    agents_title: "Agentes", agents_sub: "Personalidades con instrucciones, modelo y herramientas propias.",
    name: "Nombre", instructions: "Instrucciones", model: "Modelo", provider: "Proveedor", tools: "Herramientas",
    templates: "Plantillas de instrucciones", use_template: "Usar plantilla", active: "Activo", set_active: "Activar",
    bots_title: "Bots autónomos", bots_sub: "Tareas que Jarvis ejecuta solo cuando se dispara un activador.",
    goal: "Objetivo", trigger: "Activador", autonomy: "Autonomía", max_steps: "Límite de pasos",
    run_now: "Ejecutar ahora", pause: "Pausar", resume: "Reanudar", runs: "Ejecuciones",
    t_daily: "Diariamente a las", t_interval: "Cada (minutos)", t_voice: "Comando de voz", t_file: "Archivo modificado", t_message: "Mensaje recibido",
    a_confirm: "Pedir confirmación", a_safe: "Solo acciones seguras", a_full: "Totalmente autónomo",
    settings_title: "Configuración", s_providers: "Proveedores de IA", s_agents: "Integraciones de agentes",
    s_comms: "Comunicación", s_voice: "Voz y activación", s_general: "General", s_diagnostics: "Diagnóstico", api_key: "Clave de API",
    base_url: "URL base", default_model: "Modelo predeterminado", test: "Probar", enabled: "Habilitado",
    command: "Comando", language: "Idioma predeterminado", agent_name: "Nombre del asistente",
    wake_methods: "Métodos de activación", wake_clap: "Doble aplauso", wake_word: "Llamar por nombre",
    wake_hotkey: "Atajo de teclado", wake_ptt: "Pulsar para hablar", sensitivity: "Sensibilidad",
    tts_engine: "Motor de voz", voice_clone: "Voz clonada", upload_voice: "Subir muestra de voz",
    voice_hint: "Usa de 10 a 60 segundos de voz limpia en .wav, .mp3, .ogg, .flac o .m4a.",
    bridge_url: "Dirección de Jarvis local", host_actions: "Acciones en el host", allowlist: "Comandos permitidos",
    saved: "Guardado", local_only: "Nada sale de tu computadora, salvo las llamadas al proveedor que elijas.",
    calibrate: "Probar aplausos", clap_detected: "¡Aplausos detectados!", download: "Descargar proyecto",
  },
} as const;

export type TKey = keyof (typeof dict)["pt"];

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string }>({
  lang: "pt",
  setLang: () => {},
  t: (k) => dict.pt[k],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("pt");
  useEffect(() => {
    const saved = localStorage.getItem("jarvis.lang") as Lang | null;
    if (saved && saved in dict) setLangState(saved);
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("jarvis.lang", l);
    document.documentElement.lang = l;
  };
  return <Ctx.Provider value={{ lang, setLang, t: (k) => dict[lang][k] }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const speechLang = (l: Lang) => LANGS.find((x) => x.id === l)!.speech;
