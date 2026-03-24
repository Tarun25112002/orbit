import { Id } from "../../../../convex/_generated/dataModel";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useProjects } from "../hooks/use-projects";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
export const Navbar = ({ projectId }: { projectId: Id<"projects"> }) => {
  return (
    <>
      <nav>
        <div>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink>
                  <Button>
                    <Link href="/">
                      <Image
                        src="/logo.png"
                        alt="Home"
                        width={24}
                        height={24}
                      />
                    </Link>
                  </Button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem></BreadcrumbItem>
              <BreadcrumbPage>Demo</BreadcrumbPage>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div>
          <UserButton/>
        </div>
      </nav>
    </>
  );
};
