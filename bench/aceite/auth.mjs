import { importar, req, lerJson, verificar } from "./comum.mjs";

/** P3 — login com sessão (REQ-001..REQ-005). Cada teste usa e-mails próprios: sem cascata. */
export async function testarAuth(root, r) {
  const mod = {};
  for (const [k, rel] of [
    ["lib", "src/lib/auth.ts"],
    ["registrar", "src/app/api/auth/registrar/route.ts"],
    ["login", "src/app/api/auth/login/route.ts"],
    ["sessao", "src/app/api/auth/sessao/route.ts"],
    ["logout", "src/app/api/auth/logout/route.ts"],
  ]) {
    try {
      mod[k] = await importar(root, rel);
    } catch (e) {
      mod[k] = { __erro: String(e).slice(0, 200) };
    }
  }
  const SENHA = "Senha-Forte-123";
  let n = 0;
  const novoEmail = () => `usuario${++n}.${Date.now()}@exemplo.com`;
  const comAuth = (url, method, token) => {
    const rq = req(url, method);
    rq.headers.set("authorization", `Bearer ${token}`);
    return rq;
  };
  const exigir = (m, f) => verificar(typeof m[f] === "function", `${f} não exportado ${m.__erro || ""}`);
  async function registrar(email, senha = SENHA) {
    exigir(mod.registrar, "POST");
    return mod.registrar.POST(req("/api/auth/registrar", "POST", { email, senha }));
  }
  async function logar(email, senha = SENHA) {
    exigir(mod.login, "POST");
    return mod.login.POST(req("/api/auth/login", "POST", { email, senha }));
  }
  async function token(email) {
    await registrar(email);
    const corpo = await lerJson(await logar(email));
    verificar(corpo && typeof corpo.token === "string", "login não devolveu token");
    return corpo.token;
  }
  const semSegredo = (texto, senha) =>
    verificar(!texto.includes(senha) && !/senhaHash|hash/i.test(texto), "resposta expõe a senha ou o hash");

  await r.teste("L1", "REQ-001", "src/lib/auth.ts exporta registrarUsuario, autenticar, usuarioDaSessao, encerrarSessao, buscarUsuario", async () => {
    for (const f of ["registrarUsuario", "autenticar", "usuarioDaSessao", "encerrarSessao", "buscarUsuario"]) exigir(mod.lib, f);
  });

  await r.teste("L2", "REQ-001", "senha guardada só como hash (senhaHash ≠ senha e não a contém)", async () => {
    const email = novoEmail();
    await registrar(email);
    exigir(mod.lib, "buscarUsuario");
    const u = await mod.lib.buscarUsuario(email);
    verificar(u && typeof u.senhaHash === "string" && u.senhaHash.length >= 32, "senhaHash ausente ou curto");
    verificar(!u.senhaHash.includes(SENHA), "senhaHash contém a senha em texto");
    verificar(!("senha" in u) || u.senha !== SENHA, "senha em texto guardada");
  });

  await r.teste("L3", "REQ-002", "registrar válido → 201 com e-mail, sem senha nem hash na resposta", async () => {
    const email = novoEmail();
    const res = await registrar(email);
    verificar(res.status === 201, `status ${res.status}`);
    const txt = await res.text();
    verificar(txt.includes(email), "resposta sem o e-mail");
    semSegredo(txt, SENHA);
  });

  await r.teste("L4", "REQ-002", "e-mail inválido → 400", async () => {
    const res = await registrar("nao-e-email");
    verificar(res.status === 400, `status ${res.status}`);
  });

  await r.teste("L5", "REQ-002", "senha com menos de 8 caracteres → 400", async () => {
    const res = await registrar(novoEmail(), "Curta12");
    verificar(res.status === 400, `status ${res.status}`);
  });

  await r.teste("L6", "REQ-002", "e-mail já cadastrado → 409", async () => {
    const email = novoEmail();
    await registrar(email);
    const res = await registrar(email);
    verificar(res.status === 409, `status ${res.status}`);
  });

  await r.teste("L7", "REQ-003", "login correto → 200 com token aleatório (≥ 32 caracteres, sem o e-mail)", async () => {
    const email = novoEmail();
    await registrar(email);
    const res = await logar(email);
    verificar(res.status === 200, `status ${res.status}`);
    const txt = await res.text();
    const corpo = JSON.parse(txt);
    verificar(typeof corpo.token === "string" && corpo.token.length >= 32, "token ausente ou curto");
    verificar(!corpo.token.includes(email), "token contém o e-mail");
    semSegredo(txt, SENHA);
  });

  await r.teste("L8", "REQ-003", "senha errada e e-mail inexistente → 401 com a mesma resposta", async () => {
    const email = novoEmail();
    await registrar(email);
    const a = await logar(email, "Senha-Errada-999");
    const b = await logar(novoEmail(), SENHA);
    verificar(a.status === 401 && b.status === 401, `status ${a.status}/${b.status}`);
    verificar((await a.text()) === (await b.text()), "respostas diferentes revelam se o e-mail existe");
  });

  await r.teste("L9", "REQ-003", "dois logins do mesmo usuário geram tokens diferentes", async () => {
    const email = novoEmail();
    await registrar(email);
    const t1 = (await lerJson(await logar(email))).token;
    const t2 = (await lerJson(await logar(email))).token;
    verificar(t1 && t2 && t1 !== t2, "tokens iguais");
  });

  await r.teste("L10", "REQ-004", "sessão com token válido → 200 com e-mail, sem senha nem hash", async () => {
    exigir(mod.sessao, "GET");
    const email = novoEmail();
    const t = await token(email);
    const res = await mod.sessao.GET(comAuth("/api/auth/sessao", "GET", t));
    verificar(res.status === 200, `status ${res.status}`);
    const txt = await res.text();
    verificar(txt.includes(email), "resposta sem o e-mail");
    semSegredo(txt, SENHA);
  });

  await r.teste("L11", "REQ-004", "sessão sem token ou com token inválido → 401", async () => {
    exigir(mod.sessao, "GET");
    const a = await mod.sessao.GET(req("/api/auth/sessao", "GET"));
    const b = await mod.sessao.GET(comAuth("/api/auth/sessao", "GET", "token-que-nao-existe-0000000000000000"));
    verificar(a.status === 401 && b.status === 401, `status ${a.status}/${b.status}`);
  });

  await r.teste("L12", "REQ-005", "logout → 2xx e o token deixa de valer (sessão → 401)", async () => {
    exigir(mod.logout, "POST");
    exigir(mod.sessao, "GET");
    const t = await token(novoEmail());
    const res = await mod.logout.POST(comAuth("/api/auth/logout", "POST", t));
    verificar(res.status >= 200 && res.status < 300, `status ${res.status}`);
    const depois = await mod.sessao.GET(comAuth("/api/auth/sessao", "GET", t));
    verificar(depois.status === 401, `sessão ainda válida (${depois.status})`);
  });
}
