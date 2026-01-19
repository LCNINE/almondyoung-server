import { HttpClient } from "../utils/HttpClient.service";
export declare abstract class AbstractService {
    protected client: HttpClient;
    constructor(client: HttpClient);
}
