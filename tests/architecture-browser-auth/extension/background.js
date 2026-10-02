const HOST = "com.kaicreator.xdownload.auth_demo";
const DENIED_HOST = "com.kaicreator.xdownload.denied";
const CONTRACT_ID = "contract-demo-001";
const SNAPSHOT_ID = "snapshot-demo-001";
const observations = [];
let nativeMessageCount = 0;
const nativePayloadSizes = [];
let s4Rejected = false;
let s4Reason = null;
let suiteStarted = false;

function utf8Size(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const size = utf8Size(msg);
  const isTrustedSchema = msg && msg.type === "xd.demo.ping" && size < 1024;
  if (!isTrustedSchema) {
    s4Rejected = true;
    s4Reason = size > 16384 ? "message_too_large" : "unexpected_schema";
    sendResponse({ ok: false, reason: s4Reason });
    return false;
  }
  sendResponse({ ok: true });
  return false;
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes("/resource") || details.url.includes("/irrelevant")) {
      observations.push({
        request_id: details.requestId,
        resource_url: details.url,
        tab_id: details.tabId,
        frame_id: details.frameId,
        parent_frame_id: details.parentFrameId,
        initiator: details.initiator || null,
        type: details.type
      });
    }
  },
  { urls: ["http://127.0.0.1/*", "http://localhost/*"] }
);

function post(port, message) {
  nativeMessageCount += 1;
  nativePayloadSizes.push(utf8Size(message));
  return new Promise((resolve, reject) => {
    const onMessage = (response) => {
      cleanup();
      resolve(response);
    };
    const onDisconnect = () => {
      const message = chrome.runtime.lastError?.message || "native_disconnected";
      cleanup();
      reject(new Error(message));
    };
    const cleanup = () => {
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    port.postMessage(message);
  });
}

async function waitForObservation(fragment, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const item = observations.find((x) => x.resource_url.includes(fragment));
    if (item) return item;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`observation_timeout:${fragment}`);
}

async function connectDeniedHost() {
  return await new Promise((resolve) => {
    const port = chrome.runtime.connectNative(DENIED_HOST);
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch (_) {}
      resolve({ rejected: false, reason: "timeout_without_rejection" });
    }, 2000);
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      resolve({
        rejected: true,
        reason: chrome.runtime.lastError?.message || "disconnected"
      });
    });
  });
}

async function runSuite(tabId, pageUrl) {
  if (suiteStarted) return;
  suiteStarted = true;
  const origin = new URL(pageUrl).origin;
  const relevant = await waitForObservation("/resource?case=relevant");
  const irrelevant = await waitForObservation("/irrelevant?case=noise");

  const cookie = await chrome.cookies.get({ url: `${origin}/`, name: "xd_session" });
  if (!cookie) throw new Error("session_cookie_missing");
  const cookieHeader = `xd_session=${cookie.value}`;

  const port = chrome.runtime.connectNative(HOST);
  const create = await post(port, {
    op: "createCapability",
    binding: {
      origin,
      target_url: relevant.resource_url,
      contract_id: CONTRACT_ID,
      snapshot_id: SNAPSHOT_ID,
      tab_id: relevant.tab_id,
      frame_id: relevant.frame_id,
      request_id: relevant.request_id,
      partition_key: null
    },
    cookie_header: cookieHeader
  });
  if (!create.ok) throw new Error(`create_capability_failed:${create.reason}`);

  const boundAcquireRequest = {
    op: "acquire",
    authorization_context_ref: create.authorization_context_ref,
    binding: {
      origin,
      target_url: relevant.resource_url,
      contract_id: CONTRACT_ID,
      snapshot_id: SNAPSHOT_ID,
      tab_id: relevant.tab_id,
      frame_id: relevant.frame_id,
      request_id: relevant.request_id,
      partition_key: null
    }
  };
  const s1 = await post(port, boundAcquireRequest);

  const corePayload = {
    contract_id: CONTRACT_ID,
    snapshot_id: SNAPSHOT_ID,
    authorization_context_ref: create.authorization_context_ref,
    observation: {
      origin,
      tab_id: relevant.tab_id,
      frame_id: relevant.frame_id,
      request_id: relevant.request_id,
      resource_url: relevant.resource_url
    },
    acquisition: {
      status: s1.status,
      digest: s1.digest,
      bytes: s1.bytes
    }
  };
  const core = await post(port, { op: "coreRecord", payload: corePayload });
  const recipe = await post(port, { op: "recipeRecord", payload: {
    contract_id: CONTRACT_ID,
    authorization_context_ref: create.authorization_context_ref,
    selected_resource: relevant.resource_url
  }});
  const model = await post(port, { op: "modelRecord", payload: {
    contract_id: CONTRACT_ID,
    observed_resource: relevant.resource_url,
    authorization_context_ref: create.authorization_context_ref
  }});

  const forgedOrigin = `http://localhost:${new URL(relevant.resource_url).port}`;
  const s3 = await post(port, {
    op: "acquire",
    authorization_context_ref: create.authorization_context_ref,
    binding: {
      origin: forgedOrigin,
      target_url: `${forgedOrigin}/resource?case=cross-origin-forged`,
      contract_id: CONTRACT_ID,
      snapshot_id: SNAPSHOT_ID,
      tab_id: relevant.tab_id,
      frame_id: relevant.frame_id,
      request_id: relevant.request_id,
      partition_key: null
    }
  });

  const s5 = await connectDeniedHost();

  let s8;
  let partitionCookieValue = null;
  try {
    const random = new Uint8Array(16);
    crypto.getRandomValues(random);
    partitionCookieValue = Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("");
    const correctPartition = { topLevelSite: "https://127.0.0.1" };
    const wrongPartition = { topLevelSite: "https://localhost" };
    const setResult = await chrome.cookies.set({
      url: "https://localhost/",
      name: "xd_partition_demo",
      value: partitionCookieValue,
      secure: true,
      sameSite: "no_restriction",
      partitionKey: correctPartition
    });
    const correctCookie = await chrome.cookies.get({
      url: "https://localhost/",
      name: "xd_partition_demo",
      partitionKey: correctPartition
    });
    const wrongCookie = await chrome.cookies.get({
      url: "https://localhost/",
      name: "xd_partition_demo",
      partitionKey: wrongPartition
    });
    const partitionCap = await post(port, {
      op: "createCapability",
      binding: {
        origin: "https://localhost",
        target_url: "https://localhost/resource?case=partition",
        contract_id: CONTRACT_ID,
        snapshot_id: SNAPSHOT_ID,
        tab_id: relevant.tab_id,
        frame_id: relevant.frame_id,
        request_id: "partition-demo",
        partition_key: correctPartition.topLevelSite
      },
      cookie_header: `xd_partition_demo=${partitionCookieValue}`
    });
    const correctCheck = await post(port, {
      op: "checkCapability",
      authorization_context_ref: partitionCap.authorization_context_ref,
      binding: {
        origin: "https://localhost",
        target_url: "https://localhost/resource?case=partition",
        contract_id: CONTRACT_ID,
        snapshot_id: SNAPSHOT_ID,
        tab_id: relevant.tab_id,
        frame_id: relevant.frame_id,
        request_id: "partition-demo",
        partition_key: correctPartition.topLevelSite
      }
    });
    const wrongCheck = await post(port, {
      op: "checkCapability",
      authorization_context_ref: partitionCap.authorization_context_ref,
      binding: {
        origin: "https://localhost",
        target_url: "https://localhost/resource?case=partition",
        contract_id: CONTRACT_ID,
        snapshot_id: SNAPSHOT_ID,
        tab_id: relevant.tab_id,
        frame_id: relevant.frame_id,
        request_id: "partition-demo",
        partition_key: wrongPartition.topLevelSite
      }
    });
    s8 = {
      supported: true,
      set_partitioned_cookie: !!setResult,
      correct_partition_lookup: !!correctCookie,
      wrong_partition_lookup_absent: wrongCookie === null,
      correct_capability_binding: !!correctCheck.ok,
      wrong_capability_binding_rejected: wrongCheck.ok === false && wrongCheck.reason === "scope_mismatch"
    };
  } catch (error) {
    s8 = { supported: false, error: String(error?.message || error) };
  }

  await fetch(`${origin}/expire`, { credentials: "include" });
  const s7 = await post(port, boundAcquireRequest);

  const beforeFinalizeCount = nativeMessageCount;
  const beforeFinalizeSizes = [...nativePayloadSizes];
  const finalize = await post(port, {
    op: "finalize",
    extension_evidence: {
      extension_id: chrome.runtime.id,
      page_origin: origin,
      page_url: pageUrl,
      tab_id: tabId,
      relevant_observation: relevant,
      irrelevant_observation: irrelevant,
      s1,
      s2: {
        relevant_captured: !!relevant,
        irrelevant_captured: !!irrelevant,
        authoritative_target: relevant.resource_url,
        irrelevant_not_selected: irrelevant.resource_url !== relevant.resource_url
      },
      s3,
      s4: { rejected: s4Rejected, reason: s4Reason },
      s5,
      s7,
      s8,
      core_record_result: core,
      recipe_record_result: recipe,
      model_record_result: model,
      native_message_count_before_finalize: beforeFinalizeCount,
      native_payload_sizes_before_finalize: beforeFinalizeSizes
    }
  });
  if (!finalize.ok) throw new Error(`finalize_failed:${finalize.reason}`);
  try { port.disconnect(); } catch (_) {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && tab.url.includes("/page")) {
    runSuite(tabId, tab.url).catch(async (error) => {
      try {
        const port = chrome.runtime.connectNative(HOST);
        await post(port, {
          op: "finalize",
          extension_evidence: {
            fatal_error: String(error?.stack || error),
            extension_id: chrome.runtime.id,
            page_url: tab.url,
            s4: { rejected: s4Rejected, reason: s4Reason },
            native_message_count_before_finalize: nativeMessageCount,
            native_payload_sizes_before_finalize: [...nativePayloadSizes]
          }
        });
        port.disconnect();
      } catch (_) {}
    });
  }
});
