// ==UserScript==
// @name         Projudi - Cadastrar Nova Ação
// @namespace    https://projudi2.tjpr.jus.br/
// @version      0.7
// @description  Botão "Iniciar Autuação": abre Processos > Cadastrar Nova Ação e avança as etapas do cadastro
// @match        https://projudi2.tjpr.jus.br/projudi/*
// @grant        none
// ==/UserScript==

// Estrutura do Projudi: frameset (topFrame + mainFrame). O menu fica em mainFrame e o
// formulário de cadastro abre no iframe "userMainFrame" dentro dele. O script roda em
// todas as frames; a frame do menu inicia o fluxo e a frame do formulário executa as
// etapas. Como cada "Próximo Passo" recarrega a página, o estado fica em sessionStorage
// (compartilhado entre frames da mesma origem na mesma aba).

(function () {
    'use strict';

    const CLASSE_PROCESSUAL = '1307';
    const ASSUNTO_PRINCIPAL = '10015';
    const CHAVE_ATIVO = 'novaAcao_ativo';
    // Seleção pendente na janela da lupa: {codigo, pesquisou}. Gravada pela frame do
    // formulário e consumida pela frame da janela (iframe do Prototype Window).
    const CHAVE_SELECAO = 'novaAcao_selecao';
    // Tipo de Autuação escolhido ao iniciar; é o texto da opção de Espécie Processual
    // (select#marcador) marcada na etapa 3.
    const TIPOS_AUTUACAO = ['Ata Correicional do Foro Judicial', 'Relatório Reservado'];
    const CHAVE_TIPO = 'novaAcao_tipo';
    // Nº de partes na etapa 4 no momento em que o script clicou em Adicionar. A tabela já
    // vem com a parte automática "(Corrigente) CORREGEDORIA-GERAL DA JUSTIÇA", então só um
    // número maior que esse indica que o usuário salvou a parte nova.
    const CHAVE_PARTES = 'novaAcao_partesAntes';
    // Etapa em que o script clicou em Próximo Passo pela última vez. Se a página voltar
    // na mesma etapa, o Projudi recusou o avanço (validação); não clica de novo em loop.
    const CHAVE_ULTIMA = 'novaAcao_ultimaEtapa';
    const log = (...a) => console.log('[NovaAção]', ...a);

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

    // Aguarda fn() devolver algo truthy (menu, página e autocomplete carregam de forma assíncrona).
    async function esperar(fn, timeout = 5000) {
        const fim = Date.now() + timeout;
        while (Date.now() < fim) {
            const r = fn();
            if (r) return r;
            await sleep(100);
        }
        return null;
    }

    // ── Menu (frame mainFrame) ──────────────────────────────────────────────────────

    // O item tem href real no HTML (autuacaoProcesso.do, target="userMainFrame"); é localizado
    // pelo texto, que não muda.
    function itemNovaAcao() {
        return [...document.querySelectorAll('a[name="projudiMenu"]')]
            .find(a => norm(a.textContent) === 'cadastrar nova ação') || null;
    }

    // "Processos" é o <a> do <li> que contém o submenu do item. Não usa id/classe/aria
    // (sm-<número>-1, has-submenu, aria-controls): o SmartMenus só os cria depois do
    // carregamento, e o id muda a cada vez.
    function botaoProcessos(item) {
        const li = item && item.closest('ul') && item.closest('ul').closest('li');
        return li ? li.querySelector(':scope > a') : null;
    }

    async function iniciar(tipo) {
        sessionStorage.removeItem(CHAVE_PARTES);
        sessionStorage.removeItem(CHAVE_ULTIMA);
        sessionStorage.setItem(CHAVE_TIPO, tipo);
        log('tipo de autuação:', tipo);
        const item = await esperar(itemNovaAcao);
        if (!item) return log('item "Cadastrar Nova Ação" não encontrado no menu');

        // Abre Processos com clique real (o SmartMenus ignora eventos sintéticos) e espera o
        // submenu aparecer; se não abrir, clica no item assim mesmo, pois o href é real.
        const botao = botaoProcessos(item);
        if (botao && botao.getAttribute('aria-expanded') !== 'true') {
            log('abrindo menu', norm(botao.textContent));
            botao.click();
            await esperar(() => item.offsetParent !== null, 2000);
        }

        sessionStorage.setItem(CHAVE_ATIVO, '1');
        log('clicando em Cadastrar Nova Ação');
        item.click();
    }

    // ── Etapas do cadastro (iframe userMainFrame) ───────────────────────────────────

    // Cada etapa é identificada pelo indicador lateral <span class="currentStep">N - Título</span>.
    function etapaAtual() {
        const span = document.querySelector('span.currentStep');
        const n = span && parseInt(span.textContent, 10);
        return Number.isFinite(n) ? n : 0;
    }

    // Na etapa 1, Localidade (codComarca) e Competência (codAreaDeVaras) são carregadas por
    // AJAX em cascata a partir do Tribunal; avançar antes disso envia o formulário incompleto.
    function combosEtapa1Prontos() {
        return ['codComarca', 'codAreaDeVaras'].every(id => {
            const sel = document.getElementById(id);
            return sel && sel.options.length > 0 && sel.value && sel.value !== '0';
        });
    }

    function proximoPasso() {
        sessionStorage.setItem(CHAVE_ULTIMA, String(etapaAtual()));
        const btn = document.getElementById('nextButton');
        if (!btn) return log('botão "Próximo Passo" não encontrado');
        log('clicando em Próximo Passo');
        btn.click(); // executa o onclick (troca o action do form) e submete
    }

    // Seleção pela lupa. O autocomplete ignora a digitação simulada (as sugestões não
    // aparecem), então a lupa abre a janela "Seleção de ...", um iframe com formulário
    // próprio; o script roda nela também (ver selecionarNaJanela). Aqui só se registra o
    // código desejado, clica na lupa e espera o campo do formulário ser preenchido.
    async function selecionarPelaLupa(campoId, tituloLupa, codigo) {
        const campo = document.getElementById(campoId);
        if (!campo) return log('campo', campoId, 'não encontrado');
        if (campo.value.trim()) return true;

        const lupa = [...document.querySelectorAll('a.searchButton')].find(a => norm(a.title) === norm(tituloLupa));
        if (!lupa) return log('lupa', tituloLupa, 'não encontrada');

        sessionStorage.setItem(CHAVE_SELECAO, JSON.stringify({ codigo, pesquisou: false }));
        log('abrindo', tituloLupa);
        lupa.click(); // href="javascript:openDialogSelecao(...)"

        if (!await esperar(() => campo.value.trim(), 60000)) {
            sessionStorage.removeItem(CHAVE_SELECAO);
            return log(campoId, 'não foi preenchido pela janela de seleção');
        }
        log(campoId, '=', campo.value.trim());
        return true;
    }

    // Roda dentro da janela de seleção (classeProcessual.do, assunto...). "Pesquisar"
    // submete e recarrega a janela, por isso o progresso fica em CHAVE_SELECAO.
    function selecionarNaJanela() {
        const sel = JSON.parse(sessionStorage.getItem(CHAVE_SELECAO));
        const radio = document.querySelector('input[type="radio"][value="' + sel.codigo + '"]');
        if (radio) {
            log('marcando', sel.codigo, 'e clicando em Selecionar');
            sessionStorage.removeItem(CHAVE_SELECAO);
            radio.click();
            document.getElementById('selectButton').click();
            return;
        }
        if (sel.pesquisou) {
            sessionStorage.removeItem(CHAVE_SELECAO);
            return log('código', sel.codigo, 'não encontrado na pesquisa');
        }
        log('pesquisando', sel.codigo);
        sessionStorage.setItem(CHAVE_SELECAO, JSON.stringify({ codigo: sel.codigo, pesquisou: true }));
        document.getElementById('descricaoPesquisa').value = sel.codigo;
        document.getElementById('searchButton').click();
    }

    function selecionarEspecie(tipo) {
        const sel = document.getElementById('marcador');
        if (!sel) return log('campo Espécie Processual não encontrado');
        const opt = [...sel.options].find(o => norm(o.textContent) === norm(tipo));
        if (!opt) return log('Espécie Processual', tipo, 'não existe no select');
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        log('Espécie Processual =', opt.textContent.trim());
        return true;
    }

    function contarPartes() {
        return document.querySelectorAll('input[type="radio"][name="idxParteProcessoSelecionada"]').length;
    }

    // Etapa 4: abre o Cadastro de Parte para o usuário preencher. Salvar volta para esta
    // etapa (nova carga de página), e então o script avança.
    function etapaPartes() {
        const antes = sessionStorage.getItem(CHAVE_PARTES);
        const agora = contarPartes();
        if (antes === null) {
            sessionStorage.setItem(CHAVE_PARTES, String(agora));
            log('clicando em Adicionar (partes atuais:', agora + ')');
            return document.getElementById('addButton').click(); // onclick="adicionarParteProcesso();"
        }
        if (agora > Number(antes)) {
            sessionStorage.removeItem(CHAVE_PARTES);
            return proximoPasso();
        }
        // Voltou sem parte nova (Cancelar no cadastro): não avança nem reabre sozinho.
        sessionStorage.removeItem(CHAVE_PARTES);
        sessionStorage.removeItem(CHAVE_ATIVO);
        log('nenhuma parte nova cadastrada; automação interrompida');
    }

    // Subetapa "- Cadastro de Parte" (sem número): o usuário preenche e clica em Salvar. O
    // botão Salvar também tem id="nextButton", por isso o script não age nesta tela.
    function avisoCadastroParte() {
        const aviso = document.createElement('div');
        aviso.textContent = 'Autuação automática: preencha a parte e clique em Salvar. O script continua depois.';
        aviso.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;background:#ffc;border:1px solid #cc9;'
            + 'padding:6px 10px;font:13px sans-serif;border-radius:4px';
        document.body.appendChild(aviso);
    }

    async function executarEtapa() {
        const span = document.querySelector('span.currentStep');
        if (span && /cadastro de parte/i.test(span.textContent)) return avisoCadastroParte();
        const etapa = await esperar(etapaAtual, 5000);
        log('etapa', etapa);
        if (!etapa) return log('etapa não identificada nesta página');
        if (sessionStorage.getItem(CHAVE_ULTIMA) === String(etapa)) {
            sessionStorage.removeItem(CHAVE_ATIVO);
            return log('o Projudi não avançou da etapa', etapa, '(veja a mensagem na tela); automação interrompida');
        }
        if (etapa === 1) {
            if (!await esperar(combosEtapa1Prontos, 10000)) {
                return log('Localidade/Competência não foram preenchidas automaticamente; selecione e clique em Próximo Passo');
            }
            return proximoPasso();
        }
        if (etapa === 2) return proximoPasso();
        if (etapa === 3) {
            // Se a seleção recarregar a página, a etapa 3 roda de novo e pula o que já foi preenchido.
            if (!await selecionarPelaLupa('descricaoClasseProcessual', 'Seleção de Classe Processual', CLASSE_PROCESSUAL)) return;
            if (!await selecionarPelaLupa('descricaoAssuntoPrincipal', 'Seleção de Assunto Principal', ASSUNTO_PRINCIPAL)) return;
            if (!selecionarEspecie(sessionStorage.getItem(CHAVE_TIPO))) return;
            log('etapa 3 preenchida');
            return proximoPasso();
        }
        if (etapa === 4) return etapaPartes();
        if (etapa === 5 || etapa === 6) return proximoPasso();
        // Fim do fluxo definido até aqui; as etapas seguintes ainda não foram mapeadas.
        log('etapa', etapa, 'ainda não automatizada; automação encerrada');
        sessionStorage.removeItem(CHAVE_ATIVO);
    }

    // ── Ponto de entrada ────────────────────────────────────────────────────────────

    // Botão fixo que abre um painel perguntando o Tipo de Autuação antes de iniciar.
    function criarBotaoIniciar() {
        if (document.getElementById('novaAcao_iniciar')) return;
        const caixa = document.createElement('div');
        caixa.id = 'novaAcao_iniciar';
        caixa.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;font:13px sans-serif;text-align:left;'
            + 'background:#fff;border:1px solid #999;border-radius:4px;padding:8px;box-shadow:0 2px 6px rgba(0,0,0,.3)';

        const btn = document.createElement('button');
        btn.textContent = '▶ Iniciar Autuação';
        btn.style.cssText = 'padding:6px 10px;cursor:pointer';

        const painel = document.createElement('div');
        painel.style.cssText = 'display:none;margin-bottom:8px';
        painel.innerHTML = '<b>Tipo de Autuação:</b><br>' + TIPOS_AUTUACAO.map((t, i) =>
            '<label style="display:block;margin:4px 0;cursor:pointer"><input type="radio" name="novaAcao_tipo" value="'
            + i + '"' + (i === 0 ? ' checked' : '') + '> ' + t + '</label>').join('');

        const confirmar = document.createElement('button');
        confirmar.textContent = 'Iniciar';
        confirmar.style.cssText = 'padding:4px 10px;cursor:pointer;margin-right:6px';
        const cancelar = document.createElement('button');
        cancelar.textContent = 'Cancelar';
        cancelar.style.cssText = 'padding:4px 10px;cursor:pointer';
        painel.append(confirmar, cancelar);

        const alternar = aberto => { painel.style.display = aberto ? 'block' : 'none'; btn.style.display = aberto ? 'none' : ''; };
        btn.onclick = () => alternar(true);
        cancelar.onclick = () => alternar(false);
        confirmar.onclick = () => {
            const i = painel.querySelector('input[name="novaAcao_tipo"]:checked').value;
            alternar(false);
            iniciar(TIPOS_AUTUACAO[i]);
        };

        caixa.append(painel, btn);
        document.body.appendChild(caixa);
    }

    const ehJanelaSelecao = document.getElementById('descricaoPesquisa') && document.getElementById('selectButton');
    if (ehJanelaSelecao) {
        if (sessionStorage.getItem(CHAVE_SELECAO)) selecionarNaJanela();
    } else if (document.getElementById('autuacaoProcessoForm')) {
        if (sessionStorage.getItem(CHAVE_ATIVO)) executarEtapa();
    } else {
        // O botão vai só na frame que contém o menu (mainFrame).
        esperar(itemNovaAcao, 15000).then(item => { if (item) criarBotaoIniciar(); });
    }
})();
