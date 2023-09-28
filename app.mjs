import * as k8s from '@kubernetes/client-node';
import {TwingateUtilManager} from "./TwingateUtilManager.mjs";
import dotenvPkg from 'dotenv';
import AsyncLock from 'async-lock';

// Code below is a sample that uses Kubernetes watch API to monitor ingress changes and create Twingate resources
// Note: GKE does not fire delete events for ingress

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

dotenvPkg.config();

const delay = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

const watch = new k8s.Watch(kc);


let [remoteNetwork, domainList, group] = [process.env.TG_REMOTE_NETWORK, process.env.DOMAIN_LIST.split(","), process.env.TG_GROUP_NAME];


const main = async () => {
    try {
        const utilManager = new TwingateUtilManager();

        const remoteNetworkId = await utilManager.lookupRemoteNetworkByName(remoteNetwork);

        const groupId = await utilManager.lookupGroupByName(group);

        // Get all resources in the remote network
        let resources = await utilManager.fetchAllResourcesInRemoteNetwork(remoteNetworkId);

        let continueWatch = true;
        while (continueWatch) {
            resources = await utilManager.fetchAllResourcesInRemoteNetwork(remoteNetworkId);
            continueWatch = await Promise.all([
                watchForIngressChanges(utilManager, remoteNetworkId, groupId, resources),
                watchForServiceChanges(utilManager, remoteNetworkId, groupId, resources),
            ])
            // continueWatch = continueWatch[0] && continueWatch[1]
            console.log("-------")
            console.log(continueWatch)
            console.log(continueWatch[0] && continueWatch[1])
            console.log(continueWatch[0] || continueWatch[1])
        }

    } catch (err) {
        console.error(err);
        throw err;
    }
};


const watchForIngressChanges = async (utilManager, remoteNetworkId, groupId, resources) => {
    console.log("Start or Restarting Watching For Ingress Changes.")
    let continueWatch = true;
    // Start watch for K8S ingress changes

    let lock = new AsyncLock()

    let hosts = [];

    const req = await watch.watch(
        '/apis/networking.k8s.io/v1/ingresses',
        {},
        async (type, apiObj) => {
            if (type != 'ADDED') {
                console.log('Ingress watch unknown type: ' + type);
                return;
            }

            const host = apiObj.spec.rules[0].host;

            // Check if the ingress host is part of the domain list
            if (domainList.filter(domainList => host.endsWith(domainList)).length !== 0) {
                if (hosts.includes(host)) {
                    console.log(`Skipping: ingress resource '${host}' with name '${apiObj.metadata.name}'- resource being created`);
                    return
                }
            }
            else {
                console.log(`Skipping: ingress '${apiObj.metadata.name}: ${host}' is not part of domain list.`);
                return;
            }

            lock.acquire(host, async function() {

                if (hosts.includes(host)) {
                    console.log(`Skipping: ingress resource '${host}' with name '${apiObj.metadata.name}' - resource being created`);
                    return
                }

                if (resources.map(resource => resource.address.value).includes(host)) {
                    console.log(`Skipping: ingress resource '${host}' with name '${apiObj.metadata.name}' has already been created in remote network ${remoteNetwork} previously.`);
                    return;
                }
                hosts.push(host);
                await utilManager.createResource(apiObj.metadata.name, host, remoteNetworkId, undefined, groupId);
                console.log(`New Ingress Found: creating resource '${host}' with name '${apiObj.metadata.name}' in remote network ${remoteNetwork}`);

            }, function(err, ret) {

            }, {});


        },
        // done callback is called if the watch terminates normally
        (err) => {
            console.warn(`Ingress watch error: ${err}. This message should be harmless.`);
        },
    );

    // Watch for x ms before starting a new watch api call
    await delay(600000);
    return continueWatch;
}

const watchForServiceChanges = async (utilManager, remoteNetworkId, groupId, resources) => {
    console.log("Start or Restarting Watching For Service Changes.")
    let continueWatch = true;
    // Start watch for K8S ingress changes

    let lock = new AsyncLock()

    let hosts = [];

    const req = await watch.watch(
        '/api/v1/services',
        {},
        async (type, apiObj) => {
            console.log("|||||||||||||||||")
            console.log(host)

            if (type != 'ADDED') {
                console.log('Service watch unknown type: ' + type);
                return;
            }

            const host = apiObj;
            console.log("|||||||||||||||||")
            console.log(host)



            // if (hosts.includes(host)) {
            //     console.log(`Skipping: service resource '${host}' with name '${apiObj.metadata.name}'- resource being created`);
            //     return
            // }


            lock.acquire(host, async function() {



                // if (hosts.includes(host)) {
                //     console.log(`Skipping: service resource '${host}' with name '${apiObj.metadata.name}' - resource being created`);
                //     return
                // }
                //
                // if (resources.map(resource => resource.address.value).includes(host)) {
                //     console.log(`Skipping: service resource '${host}' with name '${apiObj.metadata.name}' has already been created in remote network ${remoteNetwork} previously.`);
                //     return;
                // }
                // hosts.push(host);
                // await utilManager.createResource(apiObj.metadata.name, host, remoteNetworkId, undefined, groupId);
                // console.log(`New Ingress Found: creating resource '${host}' with name '${apiObj.metadata.name}' in remote network ${remoteNetwork}`);

            }, function(err, ret) {

            }, {});


        },
        // done callback is called if the watch terminates normally
        (err) => {
            console.warn(`Watch error: ${err}. This message should be harmless.`);
        },
    );

    // Watch for x ms before starting a new watch api call
    await delay(600000);
    return continueWatch;
}

main();