// ==UserScript==
// @name         Projudi - Cadastrar Nova Ação
// @namespace    https://projudi2.tjpr.jus.br/
// @version      0.5
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

    async function iniciar() {
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

    async function executarEtapa() {
        const etapa = await esperar(etapaAtual, 5000);
        log('etapa', etapa);
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
            log('etapa 3 preenchida');
            // Fim do fluxo definido até aqui; as próximas etapas ainda não foram mapeadas.
            sessionStorage.removeItem(CHAVE_ATIVO);
        }
    }

    // ── Ponto de entrada ────────────────────────────────────────────────────────────

    function criarBotaoIniciar() {
        if (document.getElementById('novaAcao_iniciar')) return;
        const btn = document.createElement('button');
        btn.id = 'novaAcao_iniciar';
        btn.textContent = '▶ Iniciar Autuação';
        btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;padding:8px 12px;cursor:pointer';
        btn.onclick = iniciar;
        document.body.appendChild(btn);
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
