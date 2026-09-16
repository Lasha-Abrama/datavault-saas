import { Transform } from "class-transformer"
import { IsNumber } from "class-validator"


export class QueryParams {

    @Transform(({value}) => Number(value) )
    @IsNumber()
    page: number = 1

    @Transform(({value}) => Number(value) )
    @IsNumber()
    take: number = 30

}