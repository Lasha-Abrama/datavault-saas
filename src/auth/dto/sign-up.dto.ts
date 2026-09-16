
import { IsEmail, IsNotEmpty, IsNumber, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from "class-validator"


export class SignUpDto{
    @IsNotEmpty()
    @IsEmail()
    email: string

    @IsNotEmpty()
    @IsString()
    @Length(6, 20)
    password: string


    @IsNotEmpty()
    @IsString()
    fullName: string

    // @IsNotEmpty()
    // @IsString()
    // lastName: string


    // @IsNotEmpty()
    // @IsString()
    // @MinLength(9, {message: "phone number is too short"})
    // @MaxLength(9, {message: "phone number is too long"})
    // @Matches(/^5\d{8}$/, {message: "Wrong phone number"})
    // phoneNumber: number
}
